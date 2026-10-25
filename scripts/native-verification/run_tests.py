#!/usr/bin/env python3
"""Build and test with Xcode Swift; all generated artifacts live in a temp directory."""
import hashlib
import json
from pathlib import Path
import os
import subprocess
import tempfile
import time

SOURCE = Path(__file__).resolve().parent
NATIVE = SOURCE.parent.parent / "runtime/rea/bridge/native"
MIB = 1024 * 1024


def run(command, **kwargs):
    return subprocess.run(command, text=True, capture_output=True, timeout=120, **kwargs)


def main():
    with tempfile.TemporaryDirectory(prefix="rea-native-verification-") as temporary:
        root = Path(temporary)
        binary = root / "verify"
        tests = root / "tests"
        common = ["xcrun", "swiftc", "-swift-version", "6", "-O",
                  "-module-cache-path", str(root / "module-cache")]
        for output, sources, flags in [
            (binary, ["Verifier.swift", "main.swift"], []),
            (tests, ["Verifier.swift", "Tests.swift"], ["-parse-as-library"]),
        ]:
            build = run(common + flags + [str(SOURCE / s) for s in sources] + ["-o", str(output)])
            assert build.returncode == 0, build.stderr
        print("Compilation: passed (CLI and Swift test executable)")
        suite = run([str(tests)])
        assert suite.returncode == 0, suite.stdout + suite.stderr
        print(suite.stdout, end="")

        identity_source = str(NATIVE / "NativeExecutableIdentity.swift")
        integrated_tests = root / "integrated-tests"
        integrated_cli = root / "integrated-verify"
        build = run(common + ["-D", "NATIVE_IDENTITY_TESTING", "-parse-as-library",
                              identity_source, str(SOURCE / "NativeIdentityTests.swift"),
                              "-o", str(integrated_tests)])
        assert build.returncode == 0, build.stderr
        suite = run([str(integrated_tests)])
        assert suite.returncode == 0, suite.stdout + suite.stderr
        print(suite.stdout, end="")
        # Match production's default optimization/language mode for the benchmark.
        production_common = ["xcrun", "swiftc", "-module-cache-path", str(root / "module-cache")]
        build = run(production_common + ["-parse-as-library", identity_source,
                    str(SOURCE / "NativeIdentityCLI.swift"), "-o", str(integrated_cli)])
        assert build.returncode == 0, build.stderr

        # Test the actual observe() body with deterministic process lookup and a
        # stopping window double. Production sources are never modified.
        observation = (NATIVE / "ReaNativeUI.swift").read_text()
        body, separator, _ = observation.partition("Task { @MainActor in")
        assert separator, "observation entry point changed"
        assert body.count("NSRunningApplication(processIdentifier:") == 2
        body = body.replace("NSRunningApplication(processIdentifier:", "FixtureRunningApplication(processIdentifier:")
        window_call = "CGWindowListCopyWindowInfo([.optionIncludingWindow], request.window_id)"
        assert body.count(window_call) == 1
        body = body.replace(window_call, "fixtureWindows()")
        test_observe = root / "TestObserve.swift"
        test_observe.write_text(body)
        observation_tests = root / "observation-tests"
        build = run(production_common + ["-parse-as-library", identity_source,
                    str(NATIVE / "NativeUIChildren.swift"), str(test_observe),
                    str(SOURCE / "ObservationIdentityTests.swift"), "-o", str(observation_tests)])
        assert build.returncode == 0, build.stderr
        suite = run([str(observation_tests)])
        assert suite.returncode == 0, suite.stdout + suite.stderr
        print(suite.stdout, end="")

        small = root / "small"
        small.write_bytes(b"fixture\n")
        expected = hashlib.sha256(small.read_bytes()).hexdigest()

        def verify(arguments, expected_code, exit_code):
            completed = run([str(binary)] + arguments)
            assert completed.returncode == exit_code, completed.stderr
            assert completed.stderr == "", completed.stderr
            result = json.loads(completed.stdout)
            assert result["code"] == expected_code, result
            assert result["ok"] == (exit_code == 0), result
            assert completed.stdout == json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n"
            return completed.stdout

        first = verify([str(small), expected], "verified", 0)
        assert first == verify([str(small), expected], "verified", 0)
        for args in [[], [str(small)], [str(small), expected, "extra"],
                     [str(small), "bad"], ["", expected]]:
            verify(args, "invalid_arguments", 2)
        verify([str(small), "0" * 64], "digest_mismatch", 1)
        print("CLI contract: passed (valid, deterministic JSON, invalid arguments, digest mismatch)")

        large = root / "large-sparse"
        size = 272 * MIB + 17
        with large.open("wb") as stream:
            stream.truncate(size)
        # Independently calculate the known all-zero fixture digest in bounded memory.
        hasher = hashlib.sha256()
        zeros = bytes(MIB)
        for _ in range(size // MIB):
            hasher.update(zeros)
        hasher.update(zeros[:size % MIB])

        def measured(path, sha, executable=binary):
            start = time.perf_counter()
            with subprocess.Popen([str(executable), str(path), sha], text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
                _, status, usage = os.wait4(process.pid, 0)
                process.returncode = os.waitstatus_to_exitcode(status)
                stdout, stderr = process.communicate()
                assert process.returncode == 0, stdout + stderr
            elapsed = time.perf_counter() - start
            result = json.loads(stdout)
            if executable == binary:
                assert result == {"ok": True, "code": "verified", "bytesVerified": path.stat().st_size, "sha256": sha}, result
            else:
                assert result == {"ok": True}, result
            # Darwin reports ru_maxrss in bytes; this harness targets macOS only.
            return elapsed, usage.ru_maxrss

        _, small_rss = measured(small, expected)
        elapsed, large_rss = measured(large, hasher.hexdigest())
        # Coarse empirical guard against whole-file allocation; not a formal memory proof.
        assert large_rss < 96 * MIB, f"large-file RSS too high: {large_rss}"
        assert large_rss - small_rss < 16 * MIB, f"RSS grew with file size: {small_rss}, {large_rss}"
        print(json.dumps({
            "largeFixtureBytes": size,
            "allocatedFixtureBytes": large.stat().st_blocks * 512,
            "elapsedSeconds": round(elapsed, 4),
            "throughputMiBPerSecond": round(size / MIB / elapsed, 1),
            "smallPeakRSSBytes": small_rss,
            "largePeakRSSBytes": large_rss,
            "boundedMemoryCheck": "passed",
        }, sort_keys=True))
        _, integrated_small_rss = measured(small, expected, integrated_cli)
        integrated_elapsed, integrated_large_rss = measured(large, hasher.hexdigest(), integrated_cli)
        assert integrated_large_rss < 96 * MIB
        assert integrated_large_rss - integrated_small_rss < 16 * MIB
        print(json.dumps({
            "implementation": "integrated verifier, production compiler flags",
            "largeFixtureBytes": size,
            "elapsedSeconds": round(integrated_elapsed, 4),
            "throughputMiBPerSecond": round(size / MIB / integrated_elapsed, 1),
            "smallPeakRSSBytes": integrated_small_rss,
            "largePeakRSSBytes": integrated_large_rss,
            "boundedMemoryCheck": "passed",
        }, sort_keys=True))
    assert not root.exists(), "temporary build/test artifacts were not removed"
    print("Temporary artifact cleanup: passed")


if __name__ == "__main__":
    main()
