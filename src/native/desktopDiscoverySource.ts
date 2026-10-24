/** Fixed, read-only helper. Compiled locally; never accepts source or commands from a target. */
export const DESKTOP_DISCOVERY_SWIFT = String.raw`
import AppKit
import ApplicationServices

struct Selection: Decodable { let pid: Int32; let executable: String; let launchTime: Double; let windowId: UInt32 }
func emit(_ value: [String: Any]) throws {
  let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  FileHandle.standardOutput.write(bytes)
}
func canonical(_ path: String) -> String { URL(fileURLWithPath: path).resolvingSymlinksInPath().path }
let axTrusted = AXIsProcessTrusted()
let screenAllowed = CGPreflightScreenCaptureAccess()
let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && !$0.isTerminated }
let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
let windows = (windowInfo ?? []).filter { ($0[kCGWindowLayer as String] as? Int) == 0 }
var apps: [[String: Any]] = []
for app in running.prefix(256) {
  guard let executable = app.executableURL?.path else { continue }
  let selectedWindows: [[String: Any]] = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier }.prefix(128).compactMap { info in
    guard let id = info[kCGWindowNumber as String] as? NSNumber,
      let bounds = info[kCGWindowBounds as String] as? [String: Any],
      let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double, width > 0, height > 0 else { return nil }
    return ["id": id, "title": String((info[kCGWindowName as String] as? String ?? "").prefix(4096)), "bounds": bounds]
  }
  apps.append(["pid": app.processIdentifier, "name": String((app.localizedName ?? "Application").prefix(256)),
    "bundleId": app.bundleIdentifier ?? NSNull() as Any, "executable": canonical(executable),
    "launchTime": app.launchDate.map { $0.timeIntervalSince1970 as Any } ?? NSNull(), "windows": selectedWindows])
}
var menu: [String: Any] = ["status": "not-requested", "items": []]
if CommandLine.arguments.count == 2 {
  do {
    let selection = try JSONDecoder().decode(Selection.self, from: Data(CommandLine.arguments[1].utf8))
    guard let app = running.first(where: { $0.processIdentifier == selection.pid }),
      let executable = app.executableURL?.path, canonical(executable) == selection.executable,
      app.launchDate?.timeIntervalSince1970 == selection.launchTime,
      windows.contains(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == selection.pid && ($0[kCGWindowNumber as String] as? UInt32) == selection.windowId }) else {
        try emit(["error": "The selected application or window changed. Refresh running applications and select it again."])
        exit(0)
    }
    menu = ["status": axTrusted ? "unavailable" : "permission-denied", "items": []]
    if axTrusted {
      let element = AXUIElementCreateApplication(selection.pid)
      AXUIElementSetMessagingTimeout(element, 1)
      var bar: CFTypeRef?
      if AXUIElementCopyAttributeValue(element, kAXMenuBarAttribute as CFString, &bar) == .success,
        let bar = bar, CFGetTypeID(bar) == AXUIElementGetTypeID() {
        var values: CFArray?
        if AXUIElementCopyAttributeValues(bar as! AXUIElement, kAXChildrenAttribute as CFString, 0, 40, &values) == .success,
          let children = values as? [AXUIElement] {
          var items: [[String: Any]] = []
          for child in children {
            var owner: pid_t = 0
            guard AXUIElementGetPid(child, &owner) == .success && owner == selection.pid else { continue }
            var title: CFTypeRef?; var role: CFTypeRef?
            AXUIElementCopyAttributeValue(child, kAXTitleAttribute as CFString, &title)
            AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &role)
            items.append(["title": (title as? String).map { String($0.prefix(4096)) } ?? NSNull() as Any,
              "role": role as? String ?? NSNull() as Any])
          }
          menu = ["status": "captured", "items": items, "scope": "At most 40 top-level application menu labels; submenus were not opened or traversed."]
        }
      }
    }
  } catch { try emit(["error": "Invalid fixed desktop discovery selection."]); exit(0) }
}
try emit(["applications": apps, "permissions": ["accessibility": axTrusted, "screenCapture": screenAllowed],
  "windowServerAvailable": windowInfo != nil, "truncated": running.count > 256 || running.contains(where: { app in windows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier }.count > 128 }), "menu": menu])
`;
