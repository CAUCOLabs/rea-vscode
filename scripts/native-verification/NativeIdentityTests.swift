import CryptoKit
import Darwin
import Foundation

private enum TestFailure: Error { case assertion(String) }
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw TestFailure.assertion(message) }
}
private func digest(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
private func mismatch(_ body: () throws -> Void) throws {
  do { try body(); throw TestFailure.assertion("identity mismatch was accepted") }
  catch NativeExecutableIdentityError.mismatch { }
}
private func ioFailure(_ code: Int32, _ body: () throws -> Void) throws {
  do { try body(); throw TestFailure.assertion("I/O failure was accepted") }
  catch NativeExecutableIdentityError.ioFailure(_, let observed) {
    try require(observed == code, "wrong errno: \(observed)")
  }
}

@main
struct NativeIdentityTests {
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("rea-integrated-identity-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let path = root.appendingPathComponent("fixture").path
    // Nonuniform bytes expose skipped, duplicated or mispositioned reads.
    let data = Data((0..<(2 * NativeExecutableIdentityVerifier.chunkSize + 317)).map { UInt8(truncatingIfNeeded: $0 * 13 + $0 / 251) })
    let expected = digest(data)
    var passed = 0
    func reset() throws {
      try data.write(to: URL(fileURLWithPath: path), options: .atomic)
      try require(chmod(path, 0o600) == 0, "fixture chmod failed")
    }
    func test(_ name: String, _ body: () throws -> Void) throws {
      try reset()
      try body()
      passed += 1
      print("PASS integrated \(name)")
    }
    try test("small valid file") {
      try NativeExecutableIdentityVerifier().verify(canonicalPath: path, expectedSHA256: expected)
    }
    try test("empty file and EOF probe") {
      try Data().write(to: URL(fileURLWithPath: path))
      try NativeExecutableIdentityVerifier().verify(canonicalPath: path, expectedSHA256: digest(Data()))
    }
    try test("incorrect and malformed digest") {
      for sha in [String(repeating: "0", count: 64), "bad", expected.uppercased()] {
        try mismatch { try NativeExecutableIdentityVerifier().verify(canonicalPath: path, expectedSHA256: sha) }
      }
    }
    try test("explicit offsets, short reads, EINTR and cursor independence") {
      var next: off_t = 0
      var interrupted = false
      var eofInterrupted = false
      var descriptor: Int32 = -1
      var verifier = NativeExecutableIdentityVerifier()
      verifier.readOverride = { fd, pointer, count, offset in
        descriptor = fd
        precondition(offset == next, "incorrect pread offset")
        precondition(count > 0 && count <= NativeExecutableIdentityVerifier.chunkSize)
        if !interrupted { interrupted = true; errno = EINTR; return -1 }
        if offset == data.count && !eofInterrupted { eofInterrupted = true; errno = EINTR; return -1 }
        let received = Darwin.pread(fd, pointer, min(count, 65521), offset)
        if received > 0 { next += off_t(received) }
        return received
      }
      verifier.afterChunk = { fd, _ in
        // A sequential reader would now hash the wrong bytes or probe the wrong EOF.
        precondition(lseek(fd, 7, SEEK_SET) == 7)
        precondition(fcntl(fd, F_GETFL) & O_ACCMODE == O_RDONLY)
        precondition(fcntl(fd, F_GETFD) & FD_CLOEXEC != 0)
      }
      try verifier.verify(canonicalPath: path, expectedSHA256: expected)
      try require(next == data.count && interrupted && eofInterrupted, "read coverage incomplete")
      try require(fcntl(descriptor, F_GETFD) == -1 && errno == EBADF, "success descriptor leaked")
    }
    for eof in [false, true] {
      try test("operational read failure \(eof ? "at EOF" : "in body") and cleanup") {
        var descriptor: Int32 = -1
        var verifier = NativeExecutableIdentityVerifier()
        verifier.readOverride = { fd, pointer, count, offset in
          descriptor = fd
          if !eof || offset == data.count { errno = EIO; return -1 }
          return Darwin.pread(fd, pointer, count, offset)
        }
        try ioFailure(EIO) { try verifier.verify(canonicalPath: path, expectedSHA256: expected) }
        try require(fcntl(descriptor, F_GETFD) == -1 && errno == EBADF, "I/O failure descriptor leaked")
      }
    }
    try test("symlink, directory and FIFO rejection; admission cleanup") {
      let link = root.appendingPathComponent("link").path
      let fifo = root.appendingPathComponent("fifo").path
      try FileManager.default.createSymbolicLink(atPath: link, withDestinationPath: path)
      try require(mkfifo(fifo, 0o600) == 0, "mkfifo failed")
      let slot = open(path, O_RDONLY)
      try require(slot >= 0, "probe open failed")
      _ = close(slot)
      for _ in 0..<25 {
        for rejected in [link, root.path, fifo] {
          try mismatch { try NativeExecutableIdentityVerifier().verify(canonicalPath: rejected, expectedSHA256: expected) }
        }
      }
      let next = open(path, O_RDONLY)
      defer { if next >= 0 { _ = close(next) } }
      try require(next == slot, "admission descriptor leaked")
    }
    try test("missing file is an operational open failure") {
      try ioFailure(ENOENT) {
        try NativeExecutableIdentityVerifier().verify(canonicalPath: root.appendingPathComponent("missing").path, expectedSHA256: expected)
      }
    }
    for mutation in ["growth", "truncate", "mode", "timestamp", "content", "replacement", "symlink", "unlink"] {
      try test("\(mutation) rejection and cleanup") {
        var descriptor: Int32 = -1
        var changed = false
        var succeeded = false
        var verifier = NativeExecutableIdentityVerifier()
        verifier.afterChunk = { fd, _ in
          descriptor = fd
          guard !changed else { return }
          changed = true
          switch mutation {
          case "growth", "truncate":
            succeeded = truncate(path, off_t(data.count + (mutation == "growth" ? 1 : -1))) == 0
          case "mode": succeeded = chmod(path, 0o400) == 0
          case "timestamp":
            var times = [timeval(tv_sec: 1, tv_usec: 123456), timeval(tv_sec: 1, tv_usec: 654321)]
            succeeded = utimes(path, &times) == 0
          case "content":
            let writer = open(path, O_WRONLY)
            if writer >= 0 {
              var byte: UInt8 = 42
              succeeded = pwrite(writer, &byte, 1, off_t(data.count - 1)) == 1
              _ = close(writer)
            }
          case "replacement", "symlink":
            let retained = root.appendingPathComponent("retained-\(mutation)").path
            succeeded = rename(path, retained) == 0
            if succeeded {
              if mutation == "symlink" { succeeded = symlink(retained, path) == 0 }
              else { succeeded = FileManager.default.createFile(atPath: path, contents: data) }
            }
          default: succeeded = unlink(path) == 0
          }
        }
        try mismatch { try verifier.verify(canonicalPath: path, expectedSHA256: expected) }
        try require(succeeded, "fixture mutation failed")
        try require(fcntl(descriptor, F_GETFD) == -1 && errno == EBADF, "mutation descriptor leaked")
      }
    }
    try test("EOF probe rejects unexpected extra data") {
      var verifier = NativeExecutableIdentityVerifier()
      verifier.readOverride = { fd, pointer, count, offset in
        if offset == data.count { pointer.storeBytes(of: UInt8(1), as: UInt8.self); return 1 }
        return Darwin.pread(fd, pointer, count, offset)
      }
      try mismatch { try verifier.verify(canonicalPath: path, expectedSHA256: expected) }
    }
    try test("unexpected early EOF") {
      var verifier = NativeExecutableIdentityVerifier()
      verifier.readOverride = { _, _, _, _ in 0 }
      try mismatch { try verifier.verify(canonicalPath: path, expectedSHA256: expected) }
    }
    try test("digest rejection descriptor cleanup") {
      var descriptor: Int32 = -1
      var verifier = NativeExecutableIdentityVerifier()
      verifier.afterChunk = { fd, _ in descriptor = fd }
      try mismatch { try verifier.verify(canonicalPath: path, expectedSHA256: String(repeating: "0", count: 64)) }
      try require(fcntl(descriptor, F_GETFD) == -1 && errno == EBADF, "digest rejection descriptor leaked")
    }
    print("\(passed) integrated Swift tests passed")
  }
}
