import CryptoKit
import Darwin
import Foundation

// Keep identity rejection distinct from operational failures. The observation
// boundary maps only mismatches to target-mismatch; I/O retains capture-failed.
enum NativeExecutableIdentityError: Error, LocalizedError {
  case mismatch(String)
  case ioFailure(operation: String, errno: Int32)

  var errorDescription: String? {
    switch self {
    case .mismatch(let message): return message
    case .ioFailure(let operation, let code):
      return "Running executable verification failed during \(operation) (errno \(code))"
    }
  }
}

private struct NativeExecutableMetadata: Equatable {
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

struct NativeExecutableIdentityVerifier {
  static let chunkSize = 1024 * 1024

  #if NATIVE_IDENTITY_TESTING
  // Synchronous fault injection for temporary-file tests; absent in the helper.
  var readOverride: ((Int32, UnsafeMutableRawPointer, Int, off_t) -> Int)?
  var afterChunk: ((Int32, off_t) -> Void)?
  #endif

  private func readAt(_ descriptor: Int32, _ buffer: UnsafeMutableRawPointer,
                      _ count: Int, _ offset: off_t) -> Int {
    #if NATIVE_IDENTITY_TESTING
    if let readOverride { return readOverride(descriptor, buffer, count, offset) }
    #endif
    return Darwin.pread(descriptor, buffer, count, offset)
  }

  func verify(canonicalPath: String, expectedSHA256: String) throws {
    guard !canonicalPath.isEmpty, !canonicalPath.utf8.contains(0),
      expectedSHA256.utf8.count == 64,
      expectedSHA256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
      throw NativeExecutableIdentityError.mismatch("Running executable path or expected digest is invalid")
    }
    let descriptor = canonicalPath.withCString {
      open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
    }
    guard descriptor >= 0 else {
      let code = errno
      if code == ELOOP {
        throw NativeExecutableIdentityError.mismatch("Running executable path is a symbolic link")
      }
      throw NativeExecutableIdentityError.ioFailure(operation: "open", errno: code)
    }
    defer { _ = close(descriptor) }

    func descriptorMetadata() throws -> NativeExecutableMetadata {
      var value = stat()
      guard fstat(descriptor, &value) == 0 else {
        throw NativeExecutableIdentityError.ioFailure(operation: "fstat", errno: errno)
      }
      return NativeExecutableMetadata(value)
    }
    func pathMetadata() throws -> NativeExecutableMetadata {
      var value = stat()
      guard canonicalPath.withCString({ lstat($0, &value) }) == 0 else {
        let code = errno
        if code == ENOENT || code == ENOTDIR {
          throw NativeExecutableIdentityError.mismatch("Running executable path disappeared or was replaced")
        }
        throw NativeExecutableIdentityError.ioFailure(operation: "lstat", errno: code)
      }
      return NativeExecutableMetadata(value)
    }
    let initial = try descriptorMetadata()
    guard initial.isRegular, initial.size >= 0 else {
      throw NativeExecutableIdentityError.mismatch("Running executable is not a regular file with a valid size")
    }
    guard try pathMetadata() == initial else {
      throw NativeExecutableIdentityError.mismatch("Running executable path differs from the opened file")
    }
    func checkDescriptor() throws {
      let current = try descriptorMetadata()
      guard current == initial else {
        throw NativeExecutableIdentityError.mismatch("Running executable identity or metadata changed during verification")
      }
    }

    var hasher = SHA256()
    var buffer = [UInt8](repeating: 0, count: Self.chunkSize)
    var offset: off_t = 0
    while offset < initial.size {
      try checkDescriptor()
      let requested = Int(min(off_t(buffer.count), initial.size - offset))
      let count = buffer.withUnsafeMutableBytes { readAt(descriptor, $0.baseAddress!, requested, offset) }
      if count < 0 {
        let code = errno
        if code == EINTR { continue }
        throw NativeExecutableIdentityError.ioFailure(operation: "pread", errno: code)
      }
      guard count > 0 else {
        throw NativeExecutableIdentityError.mismatch("Running executable was truncated during verification")
      }
      buffer.withUnsafeBytes { hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: $0[..<count])) }
      // count <= requested <= initial.size - offset, so addition cannot overflow.
      offset += off_t(count)
      #if NATIVE_IDENTITY_TESTING
      afterChunk?(descriptor, offset)
      #endif
      try checkDescriptor()
    }
    // Never follow an expanding file indefinitely. Require EOF at its admitted size.
    var extra: UInt8 = 0
    var extraCount: Int
    repeat { extraCount = readAt(descriptor, &extra, 1, initial.size) } while extraCount < 0 && errno == EINTR
    guard extraCount >= 0 else {
      throw NativeExecutableIdentityError.ioFailure(operation: "pread EOF", errno: errno)
    }
    guard extraCount == 0 else {
      throw NativeExecutableIdentityError.mismatch("Running executable grew during verification")
    }
    try checkDescriptor()
    guard try pathMetadata() == initial else {
      throw NativeExecutableIdentityError.mismatch("Running executable path was replaced during verification")
    }
    try checkDescriptor()
    let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    guard digest == expectedSHA256 else {
      throw NativeExecutableIdentityError.mismatch("Running executable bytes differ from the active target digest")
    }
  }
}
