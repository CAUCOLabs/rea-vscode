import AppKit
// Owned, inert validation fixture. No network, file access or action handlers.
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let menu = NSMenu()
let item = NSMenuItem(title: "REA Fixture", action: nil, keyEquivalent: "")
let submenu = NSMenu(title: "REA Fixture")
let status = NSMenuItem(title: "Read-only validation fixture", action: nil, keyEquivalent: "")
status.isEnabled = false
submenu.addItem(status)
item.submenu = submenu
menu.addItem(item)
app.mainMenu = menu
let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 420, height: 240), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "REA Native Read-only Fixture"
let content = window.contentView!
let label = NSTextField(labelWithString: "Desktop evidence validation")
label.frame = NSRect(x: 24, y: 170, width: 360, height: 28)
content.addSubview(label)
let field = NSTextField(string: "Observed fixture state")
field.frame = NSRect(x: 24, y: 120, width: 360, height: 28)
content.addSubview(field)
let button = NSButton(title: "Example button", target: nil, action: nil)
button.frame = NSRect(x: 24, y: 60, width: 180, height: 32)
content.addSubview(button)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { _ in app.terminate(nil) }
app.run()
