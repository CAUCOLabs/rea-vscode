import CryptoKit
import Darwin
import Foundation

private enum TestFailure: Error { case assertion(String) }
private func require(_ value: @autoclosure () -> Bool, _ message: String) throws {
    if !value() { throw TestFailure.assertion(message) }
}
private func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

@main
struct Tests {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("rea-verification-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        var passed = 0
        func test(_ name: String, _ body: () throws -> Void) throws {
            try body()
            passed += 1
            print("PASS \(name)")
        }
        let path = root.appendingPathComponent("fixture").path
        let data = Data(repeating: 42, count: 3 * ExecutableVerifier.chunkSize + 17)
        let expected = digest(data)
        func reset() throws {
            try data.write(to: URL(fileURLWithPath: path), options: .atomic)
            try require(chmod(path, 0o600) == 0, "fixture permissions reset failed")
        }
        try reset()
        try test("small valid file and uppercase digest") {
            let result = ExecutableVerifier.verify(path: path, expectedDigest: expected.uppercased())
            try require(result.ok && result.bytesVerified == data.count && result.sha256 == expected, "valid file rejected")
        }
        try test("empty regular file") {
            let empty = root.appendingPathComponent("empty")
            try Data().write(to: empty)
            try require(ExecutableVerifier.verify(path: empty.path, expectedDigest: digest(Data())).ok, "empty file rejected")
        }
        try test("incorrect digest") {
            try require(ExecutableVerifier.verify(path: path, expectedDigest: String(repeating: "0", count: 64)).code == "digest_mismatch", "incorrect digest accepted")
        }
        try test("symbolic link") {
            let link = root.appendingPathComponent("link").path
            try FileManager.default.createSymbolicLink(atPath: link, withDestinationPath: path)
            try require(ExecutableVerifier.verify(path: link, expectedDigest: expected).code == "symbolic_link", "symlink accepted")
        }
        try test("directory and FIFO are rejected without blocking") {
            try require(ExecutableVerifier.verify(path: root.path, expectedDigest: expected).code == "not_regular_file", "directory accepted")
            let fifo = root.appendingPathComponent("fifo").path
            try require(mkfifo(fifo, 0o600) == 0, "mkfifo failed")
            try require(ExecutableVerifier.verify(path: fifo, expectedDigest: expected).code == "not_regular_file", "FIFO accepted")
        }
        for (name, operation, code) in [
            ("growth", "grow", "file_grew"), ("truncation", "truncate", "file_truncated"),
            ("mode change", "chmod", "metadata_changed"), ("timestamp change", "time", "metadata_changed"), ("same-size content change", "write", "metadata_changed"),
            ("path replacement", "replace", "path_identity_changed"), ("path symlink replacement", "symlink", "path_identity_changed")
        ] {
            try test(name) {
                try reset()
                var mutated = false
                var mutationSucceeded = false
                var observedDescriptor: Int32 = -1
                let result = ExecutableVerifier.verify(path: path, expectedDigest: expected) { descriptor, _ in
                    observedDescriptor = descriptor
                    guard !mutated else { return }
                    mutated = true
                    switch operation {
                    case "grow", "truncate":
                        mutationSucceeded = truncate(path, off_t(operation == "grow" ? data.count + 1 : data.count - 1)) == 0
                    case "chmod": mutationSucceeded = chmod(path, 0o400) == 0
                    case "time":
                        var times = [timeval(tv_sec: 1, tv_usec: 123456), timeval(tv_sec: 1, tv_usec: 654321)]
                        mutationSucceeded = utimes(path, &times) == 0
                    case "write":
                        let writer = open(path, O_WRONLY)
                        if writer >= 0 {
                            var byte: UInt8 = 7
                            mutationSucceeded = pwrite(writer, &byte, 1, off_t(data.count - 1)) == 1
                            _ = close(writer)
                        }
                    case "replace":
                        let replacement = root.appendingPathComponent("replacement").path
                        do {
                            try data.write(to: URL(fileURLWithPath: replacement))
                            // Keep the opened inode linked: rename-over-unlink can also
                            // change its ctime, legitimately detected before the path check.
                            let retained = root.appendingPathComponent("retained").path
                            mutationSucceeded = rename(path, retained) == 0 && rename(replacement, path) == 0
                        } catch { mutationSucceeded = false }
                    default:
                        let retained = root.appendingPathComponent("retained-link").path
                        mutationSucceeded = rename(path, retained) == 0 && symlink(retained, path) == 0
                    }
                }
                try require(mutationSucceeded, "mutation failed: \(name)")
                // APFS may update the original inode's ctime on rename. Either
                // rejection demonstrates the intended invariant, without timing races.
                let acceptable = operation == "replace" || operation == "symlink" ? [code, "metadata_changed"] : [code]
                try require(!result.ok && acceptable.contains(result.code), "mutation not rejected: \(result.code)")
                try require(fcntl(observedDescriptor, F_GETFD) == -1 && errno == EBADF, "descriptor leaked on rejection")
            }
        }
        try test("invalid inputs and missing path") {
            for invalid in ["", "abc", String(repeating: "g", count: 64), String(repeating: "é", count: 64)] {
                try require(ExecutableVerifier.verify(path: path, expectedDigest: invalid).code == "invalid_arguments", "invalid digest accepted")
            }
            for invalid in ["", "abc\0def"] {
                try require(ExecutableVerifier.verify(path: invalid, expectedDigest: expected).code == "invalid_arguments", "invalid path accepted")
            }
            try require(ExecutableVerifier.verify(path: root.appendingPathComponent("missing").path, expectedDigest: expected).code == "open_failed", "missing path accepted")
        }
        try test("descriptor cleanup on admission failures") {
            try reset()
            let slot = open(path, O_RDONLY)
            try require(slot >= 0, "descriptor probe failed")
            _ = close(slot)
            for _ in 0..<50 {
                try require(ExecutableVerifier.verify(path: root.path, expectedDigest: expected).code == "not_regular_file", "directory accepted")
            }
            let next = open(path, O_RDONLY)
            defer { if next >= 0 { _ = close(next) } }
            try require(next == slot, "admission failure leaked descriptors")
        }
        try test("descriptor cleanup on success and digest mismatch, repeated calls") {
            try reset()
            for index in 0..<50 {
                var observedDescriptor: Int32 = -1
                let result = ExecutableVerifier.verify(path: path, expectedDigest: index % 2 == 0 ? expected : String(repeating: "0", count: 64)) { descriptor, _ in
                    observedDescriptor = descriptor
                }
                try require(result.ok == (index % 2 == 0), "unexpected repeated result")
                try require(fcntl(observedDescriptor, F_GETFD) == -1 && errno == EBADF, "descriptor leaked")
            }
        }
        print("\(passed) Swift tests passed")
    }
}
