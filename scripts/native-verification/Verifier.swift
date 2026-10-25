import CryptoKit
import Darwin
import Foundation

struct VerificationResult: Codable {
    let ok: Bool
    let code: String
    let bytesVerified: Int64
    let sha256: String?
}

private struct VerificationFailure: Error {
    let code: String
}

private struct Metadata: Equatable {
    let device: dev_t
    let inode: ino_t
    let mode: mode_t
    let size: off_t
    let modificationSeconds: Int
    let modificationNanoseconds: Int
    let changeSeconds: Int
    let changeNanoseconds: Int

    init(_ value: stat) {
        device = value.st_dev
        inode = value.st_ino
        mode = value.st_mode
        size = value.st_size
        modificationSeconds = value.st_mtimespec.tv_sec
        modificationNanoseconds = value.st_mtimespec.tv_nsec
        changeSeconds = value.st_ctimespec.tv_sec
        changeNanoseconds = value.st_ctimespec.tv_nsec
    }

    var isRegular: Bool { mode & S_IFMT == S_IFREG }
}

enum ExecutableVerifier {
    static let chunkSize = 1024 * 1024

    static func validDigest(_ text: String) -> Bool {
        text.utf8.count == 64 && text.utf8.allSatisfy {
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
        }
    }

    // Internal synchronous test seam only; the CLI never installs a callback.
    // Runs after a chunk is hashed, before the next descriptor metadata check.
    static func verify(path: String, expectedDigest: String,
                       afterChunk: ((Int32, Int64) -> Void)? = nil) -> VerificationResult {
        var bytesVerified: Int64 = 0
        do {
            guard !path.isEmpty, !path.utf8.contains(0), validDigest(expectedDigest) else {
                throw VerificationFailure(code: "invalid_arguments")
            }
            // O_NONBLOCK prevents FIFO admission from hanging before fstat rejects it.
            // O_NOFOLLOW rejects a symbolic link in the final path component.
            let descriptor = path.withCString { open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK) }
            guard descriptor >= 0 else {
                throw VerificationFailure(code: errno == ELOOP ? "symbolic_link" : "open_failed")
            }
            defer { _ = close(descriptor) }

            func descriptorMetadata() throws -> Metadata {
                var value = stat()
                guard fstat(descriptor, &value) == 0 else { throw VerificationFailure(code: "descriptor_stat_failed") }
                return Metadata(value)
            }
            func pathMetadata() throws -> Metadata {
                var value = stat()
                guard path.withCString({ lstat($0, &value) }) == 0 else {
                    throw VerificationFailure(code: "path_stat_failed")
                }
                return Metadata(value)
            }
            let initial = try descriptorMetadata()
            guard initial.isRegular else { throw VerificationFailure(code: "not_regular_file") }
            guard initial.size >= 0 else { throw VerificationFailure(code: "invalid_size") }
            guard try pathMetadata() == initial else { throw VerificationFailure(code: "path_identity_changed") }

            func checkDescriptor() throws {
                let current = try descriptorMetadata()
                if current.size > initial.size { throw VerificationFailure(code: "file_grew") }
                if current.size < initial.size { throw VerificationFailure(code: "file_truncated") }
                guard current == initial else { throw VerificationFailure(code: "metadata_changed") }
            }
            var hasher = SHA256()
            var buffer = [UInt8](repeating: 0, count: chunkSize)
            while bytesVerified < initial.size {
                try checkDescriptor()
                let requested = Int(min(Int64(chunkSize), initial.size - bytesVerified))
                let count = buffer.withUnsafeMutableBytes { read(descriptor, $0.baseAddress!, requested) }
                if count < 0 {
                    if errno == EINTR { continue }
                    throw VerificationFailure(code: "read_failed")
                }
                guard count > 0 else { throw VerificationFailure(code: "file_truncated") }
                buffer.withUnsafeBytes { hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: $0[..<count])) }
                bytesVerified += Int64(count)
                afterChunk?(descriptor, bytesVerified)
                try checkDescriptor()
            }
            // Bound work to the admitted size, then probe EOF rather than following growth.
            var extra: UInt8 = 0
            var extraCount: Int
            repeat { extraCount = read(descriptor, &extra, 1) } while extraCount < 0 && errno == EINTR
            guard extraCount >= 0 else { throw VerificationFailure(code: "read_failed") }
            guard extraCount == 0 else { throw VerificationFailure(code: "file_grew") }
            try checkDescriptor()
            guard try pathMetadata() == initial else { throw VerificationFailure(code: "path_identity_changed") }
            try checkDescriptor()

            let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            guard digest == expectedDigest.lowercased() else { throw VerificationFailure(code: "digest_mismatch") }
            return VerificationResult(ok: true, code: "verified", bytesVerified: bytesVerified, sha256: digest)
        } catch let failure as VerificationFailure {
            return VerificationResult(ok: false, code: failure.code, bytesVerified: bytesVerified, sha256: nil)
        } catch {
            return VerificationResult(ok: false, code: "verification_failed", bytesVerified: bytesVerified, sha256: nil)
        }
    }
}
