// Test/benchmark driver for the integrated verifier; never compiled into REA.
import Darwin
import Foundation

@main
struct NativeIdentityCLI {
  static func main() {
    do {
      guard CommandLine.arguments.count == 3 else { exit(2) }
      try NativeExecutableIdentityVerifier().verify(canonicalPath: CommandLine.arguments[1], expectedSHA256: CommandLine.arguments[2])
      print("{\"ok\":true}")
    } catch {
      FileHandle.standardError.write(Data(error.localizedDescription.utf8))
      exit(1)
    }
  }
}
