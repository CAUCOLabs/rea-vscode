import Darwin
import Foundation

let arguments = CommandLine.arguments
let result: VerificationResult
if arguments.count != 3 {
    result = VerificationResult(ok: false, code: "invalid_arguments", bytesVerified: 0, sha256: nil)
} else {
    result = ExecutableVerifier.verify(path: arguments[1], expectedDigest: arguments[2])
}
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
// All fields are fixed strings, integers or ASCII digests; encoding cannot fail.
let output = try encoder.encode(result)
FileHandle.standardOutput.write(output)
FileHandle.standardOutput.write(Data([10]))
exit(result.ok ? 0 : (result.code == "invalid_arguments" ? 2 : 1))
