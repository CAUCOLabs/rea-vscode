// Compiled with a temporary copy of the real observe() implementation. Only the
// process lookup and first window lookup are replaced with deterministic doubles.
// No AppKit application is launched, observed or acted upon.
import CryptoKit
import Darwin
import Foundation

private enum ObservationTestFailure: Error { case assertion(String) }
struct FixtureProcess {
  let executableURL: URL?
  let launchDate: Date?
}
struct FixtureRunningApplication {
  static var snapshots: [FixtureProcess?] = []
  static var queries = 0
  let executableURL: URL?
  let launchDate: Date?

  init?(processIdentifier: Int32) {
    precondition(processIdentifier == 123)
    let index = Self.queries
    Self.queries += 1
    guard index < Self.snapshots.count, let state = Self.snapshots[index] else { return nil }
    executableURL = state.executableURL
    launchDate = state.launchDate
  }
}
var fixtureWindowCalls = 0
func fixtureWindows() -> CFArray? {
  fixtureWindowCalls += 1
  // Stop at the first window boundary, before AX, screenshots or actions.
  return nil
}

@main
struct ObservationIdentityTests {
  @MainActor static func main() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("rea-observation-identity-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("fixture")
    let other = root.appendingPathComponent("other")
    let data = Data("owned temporary fixture".utf8)
    try data.write(to: file)
    try data.write(to: other)
    guard let canonical = realpath(file.path, nil) else { throw ObservationTestFailure.assertion("fixture realpath failed") }
    defer { free(canonical) }
    let path = String(cString: canonical)
    let expected = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let baseline = FixtureProcess(executableURL: URL(fileURLWithPath: path), launchDate: Date(timeIntervalSince1970: 1234))
    var passed = 0
    func check(_ name: String, states: [FixtureProcess?], code: String,
               sha: String? = nil, launch: Double? = nil, expectedPath: String? = nil,
               windows: Int = 0) async throws {
      FixtureRunningApplication.snapshots = states
      FixtureRunningApplication.queries = 0
      fixtureWindowCalls = 0
      let request = Request(pid: 123, window_id: 456, executable: expectedPath ?? path,
                            sha256: sha ?? expected, launch_time: launch, screenshot: true,
                            accessibility: true, max_nodes: 10,
                            action: Action(kind: "click", path: [], direction: nil, text: nil))
      do {
        _ = try await observe(request)
        throw ObservationTestFailure.assertion("unexpected observation success")
      } catch let failure as BoundaryFailure {
        guard failure.code == code, fixtureWindowCalls == windows else {
          throw ObservationTestFailure.assertion("\(name): \(failure.code): \(failure.message), window calls \(fixtureWindowCalls)")
        }
        let envelope = try serializeHelperOutput(["ok": false, "code": failure.code, "message": failure.message])
        let parsed = try JSONSerialization.jsonObject(with: envelope) as! [String: Any]
        guard Set(parsed.keys) == Set(["ok", "code", "message"]), parsed["ok"] as? Bool == false else {
          throw ObservationTestFailure.assertion("helper error contract changed")
        }
      }
      passed += 1
      print("PASS observation \(name)")
    }
    try await check("digest failure precedes all window access/action", states: [baseline], code: "target-mismatch", sha: String(repeating: "0", count: 64))
    guard FixtureRunningApplication.queries == 1 else { throw ObservationTestFailure.assertion("digest rejection did not short-circuit") }
    try await check("initial canonical path mismatch", states: [baseline], code: "target-mismatch", expectedPath: other.path)
    try await check("initial launch mismatch", states: [baseline], code: "process-replaced", launch: 9999)
    try await check("initial launch unavailable", states: [FixtureProcess(executableURL: baseline.executableURL, launchDate: nil)], code: "process-identity-unavailable")
    try await check("process disappears after hash", states: [baseline, nil], code: "target-mismatch")
    try await check("launch changes after hash without request launch_time", states: [baseline, FixtureProcess(executableURL: baseline.executableURL, launchDate: Date(timeIntervalSince1970: 9999))], code: "process-replaced")
    try await check("launch unavailable after hash", states: [baseline, FixtureProcess(executableURL: baseline.executableURL, launchDate: nil)], code: "process-identity-unavailable")
    try await check("executable changes after hash", states: [baseline, FixtureProcess(executableURL: other, launchDate: baseline.launchDate)], code: "target-mismatch")
    try await check("stable identity reaches existing window check", states: [baseline, baseline], code: "window-mismatch", launch: 1234, windows: 1)
    guard FixtureRunningApplication.queries == 2 else { throw ObservationTestFailure.assertion("process not requeried") }
    print("\(passed) observation identity tests passed (process/window doubles; no GUI access)")
  }
}
