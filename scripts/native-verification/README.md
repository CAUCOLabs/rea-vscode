# Incremental executable verification prototype (macOS)

`Verifier.swift`, `Tests.swift` and `main.swift` retain the original isolated
prototype. The native helper now uses a separate integrated verifier at
`runtime/rea/bridge/native/NativeExecutableIdentity.swift`. The test runner covers
both implementations without changing discovery, MCP schemas or the extension UI.
The prototype requires the Xcode Swift 6.3 toolchain, macOS CryptoKit, and no external
packages. Python 3 is used only by the test runner.

## Build and run

From the repository root:

```sh
mkdir -p /tmp/rea-native-verification-build
xcrun swiftc -swift-version 6 -O \
  -module-cache-path /tmp/rea-native-verification-build/module-cache \
  scripts/native-verification/Verifier.swift \
  scripts/native-verification/main.swift \
  -o /tmp/rea-native-verification-build/verify
/tmp/rea-native-verification-build/verify /absolute/path/to/executable EXPECTED_SHA256
python3 scripts/native-verification/run_tests.py
```

The test runner compiles both executables with the installed Xcode toolchain,
runs the tests, measures a sparse fixture larger than 256 MiB, and removes its
build cache, executables, and fixtures on completion. It does not touch installed
applications or system executables. Paths are passed directly as arguments, not
through shell interpolation. The verifier accepts any regular file; it does not
require execute permission or validate a Mach-O structure or code signature.

The CLI takes exactly two positional arguments. SHA-256 must contain exactly 64
ASCII hexadecimal characters (either case). Empty paths and embedded NUL bytes
are invalid. Relative paths are accepted. Output is one compact, sorted-key JSON
object followed by a newline, with no path, timestamps, OS error text, file bytes,
or nondeterministic identifiers. Success contains `ok`, `code`, `bytesVerified`,
and `sha256`. Failure omits `sha256`. `bytesVerified` counts bytes fed to the
hasher; it does not imply that verification succeeded. Exit codes are 0 for
verified, 1 for verification failure, and 2 for invalid arguments.

Example success schema:

```json
{"bytesVerified":0,"code":"verified","ok":true,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
```

Failure codes: `invalid_arguments`, `symbolic_link`, `open_failed`,
`descriptor_stat_failed`, `path_stat_failed`, `not_regular_file`, `invalid_size`,
`path_identity_changed`, `file_grew`, `file_truncated`, `metadata_changed`,
`read_failed`, `digest_mismatch`, and defensive fallback `verification_failed`.
When several checks fail, the first observed failure determines the code.

## Checks and resource bounds

- Open once with `O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK`. The final path
  component cannot be a symbolic link. Nonblocking admission avoids waiting for
  a writer when a FIFO is mistakenly supplied; `fstat` then rejects it.
- Require a regular file and a nonnegative size. Capture descriptor metadata and
  compare it to `lstat` path metadata before reading.
- Compare device, inode, complete mode (including file type and permission bits),
  size, modification time, and change time. Darwin timestamps include seconds
  and nanoseconds. Access time is intentionally excluded because reading can
  change it.
- Reuse a single 1 MiB buffer with CryptoKit's incremental `SHA256`. Read no more
  than the admitted size, handle short reads and `EINTR`, and check descriptor
  metadata before and after each chunk. Reject early EOF, changed size, or any
  other compared metadata change.
- Probe one byte beyond the admitted size to require EOF. Check descriptor,
  then `lstat` path metadata, then descriptor metadata again. Require equality
  with the initial metadata before comparing the computed digest to the supplied
  expected digest. No 256 MiB limit is imposed.
- `defer` closes every successfully opened descriptor on normal returns and
  thrown failures, including admission failures. The OS reclaims descriptors if
  the process is terminated. No whole-file mapping or allocation is used.

Memory is O(chunk size) plus constant hasher/runtime state; work is O(admitted
file size). There is no wall-clock deadline, cancellation API, or I/O budget.
A slow filesystem can block a regular-file read despite `O_NONBLOCK`.

## Tests

`Tests.swift` covers valid small and empty files, uppercase and incorrect digests,
symlinks, directories, FIFOs, missing paths, malformed arguments, deterministic
mid-read growth/truncation, mode/timestamp/same-size content changes, path and
symlink replacement, and descriptor cleanup on success and rejection.

An internal synchronous `afterChunk` callback mutates only temporary fixtures
between a hash update and the following metadata check. The production CLI never
supplies a callback or exposes mutation controls. These tests deterministically
exercise observable mutations; they do not guarantee detection of every possible
concurrent writer schedule. A rename may also alter the original inode's ctime,
so replacement tests accept either metadata-change or path-identity rejection.

`run_tests.py` checks the CLI JSON/exit-code contract and creates an all-zero
272 MiB + 17 byte sparse fixture. Its expected digest is independently computed
with Python hashlib in bounded chunks. Darwin `wait4` reports each verifier
process's peak resident memory. The runner checks peak RSS below 96 MiB and
large-minus-small RSS below 16 MiB, then reports elapsed wall time (including
process startup), throughput, physical fixture allocation, and both RSS values.
These coarse regression thresholds detect whole-file allocation; measurements
are environment-dependent and are not a formal memory bound. Fixture deletion
and runner artifact cleanup are also checked.

## Security limitations and integration assessment

Metadata comparisons do **not** eliminate TOCTOU races. They sample state; this
is not an atomic snapshot, exclusive lock, or filesystem transaction. Writers can
change bytes between reads, restore some metadata, or mutate the file/path after
the final check. Change-time resolution and semantics depend on the filesystem;
privileged actors, remote filesystems, and inode reuse may weaken observations.
A trusted expected SHA-256 is essential: metadata checks alone cannot establish
content authenticity. An untrusted caller choosing both file and expected digest
gets no authenticity guarantee. Digest equality is not code-signature validation.

`O_NOFOLLOW` protects the final component only. Parent directories may contain
symlinks and may be renamed/rebound while resolving the path. The final `lstat`
comparison rejects observable rebinding but cannot prevent every transient race.
The prototype does not walk and pin every parent directory or reject all parent
symlinks. It does not detect changes to every attribute (for example, ACLs,
extended attributes, ownership, or flags). Hard links are permitted. Changes
that leave all compared values equal can escape metadata checks. Even successful
verification says nothing about a later path-based reopen or process launch.

The integrated verifier uses `pread` and preserves REA's expected digest from
the target resolver. The helper re-queries the selected PID after hashing and
compares executable URL path, canonical path and launch time before window
validation. Its existing response envelope, window/action ownership checks,
permissions, deadlines and cleanup remain in place. The 256 MiB rejection is
removed; this does not prove that a particular application can be captured.
The descriptor verifies the current on-disk file, not the running process's
mapped image. The first observation still establishes launch identity when the
request omits launch time; later observations retain the existing pinning.

## Integrated regression coverage

The same `run_tests.py` command additionally compiles and runs:

- `NativeIdentityTests.swift` against the actual integrated verifier, including
  nonuniform-byte positioned reads, short reads, `EINTR` in body/EOF, descriptor
  cursor perturbation, operational read errors, metadata/content/path mutations,
  nonregular/symlink rejection, EOF checks and descriptor cleanup.
- `ObservationIdentityTests.swift` against a temporary copy of the actual
  `observe()` body, substituting only the process lookup and first window lookup.
  Process changes and digest rejection must fail before any window lookup,
  screenshot, accessibility observation or action. Stable identity reaches the
  existing window guard. These are process/window doubles, not live process-race
  tests. No production source is rewritten on disk.
- `NativeIdentityCLI.swift`, a test-only driver built with production's default
  optimization and language mode, to verify the >256 MiB sparse fixture and
  measure bounded RSS independently of the original prototype.

Verifier fault-injection hooks exist only with `-D NATIVE_IDENTITY_TESTING`; the
production helper build does not include them. The original prototype's hooks
remain confined to that standalone prototype.

`npx vitest run tests/nativeExecutableIdentity.test.ts` compiles the complete
production helper source list through the real runtime, checks its error JSON
using an invalid PID, validates cancellation and temporary-root cleanup, and
checks provider error propagation and scenario short-circuiting with a fake
helper response. It does not select an installed application or perform GUI
interactions. Compilation runs under the unchanged 60-second limit, invocation
under 30 seconds and the runtime under its 180-second deadline. The sparse-file
benchmark does not establish cold-storage or multi-gigabyte performance, and
live process replacement during hashing is not deterministically tested.

The vendored `/runtime/rea/` tree is Git-ignored in this repository. Changes there
are local and can be overwritten by re-vendoring. Its distribution inventory is
not regenerated by this task; release packaging/provenance needs separate
handling before distributing the modified runtime.
