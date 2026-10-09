import AppKit

final class MarkerView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill(); bounds.fill()
        NSColor.systemBlue.setFill()
        let triangle = NSBezierPath(); triangle.move(to: NSPoint(x: bounds.midX, y: bounds.maxY - 5)); triangle.line(to: NSPoint(x: 5, y: 5)); triangle.line(to: NSPoint(x: bounds.maxX - 5, y: 5)); triangle.close(); triangle.fill()
    }
}

final class FixtureDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var count = 0
    let counter = NSTextField(labelWithString: "Count: 0")
    let scrollCounter = NSTextField(labelWithString: "Scroll: 0")
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .scrollWheel]) { event in
            print("fixture-event type=\(event.type.rawValue) window=\(event.windowNumber) x=\(event.locationInWindow.x) y=\(event.locationInWindow.y)"); fflush(stdout)
            return event
        }
        let menu = NSMenu()
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu; menu.addItem(editItem); NSApplication.shared.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 720), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Mothership Computer Use Test Fixture"
        let stack = NSStackView(); stack.orientation = .vertical; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        let field = NSTextField(string: "Fixture text"); field.setAccessibilityIdentifier("fixture-text"); field.setAccessibilityLabel("Fixture editable text")
        let secure = NSSecureTextField(string: "fixture-only-secret"); secure.setAccessibilityIdentifier("fixture-password"); secure.setAccessibilityLabel("Fixture password")
        let button = NSButton(title: "Increment", target: self, action: #selector(increment)); button.setAccessibilityIdentifier("fixture-increment")
        let slider = NSSlider(value: 25, minValue: 0, maxValue: 100, target: nil, action: nil); slider.setAccessibilityLabel("Fixture slider")
        let marker = MarkerView(); marker.setAccessibilityElement(false)
        marker.translatesAutoresizingMaskIntoConstraints = false
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let document = NSTextView(frame: NSRect(x: 0, y: 0, width: 520, height: 3000)); document.isEditable = false
        document.string = (1...150).map { "Fixture scrolling line \($0)" }.joined(separator: "\n")
        scroll.documentView = document
        scroll.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(scrolled(_:)), name: NSView.boundsDidChangeNotification, object: scroll.contentView)
        for view in [field, secure, button, counter, slider, marker, scrollCounter, scroll] { stack.addArrangedSubview(view) }
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 30), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -30), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 30), field.widthAnchor.constraint(equalTo: stack.widthAnchor), secure.widthAnchor.constraint(equalTo: stack.widthAnchor), slider.widthAnchor.constraint(equalTo: stack.widthAnchor), scroll.widthAnchor.constraint(equalTo: stack.widthAnchor), scroll.heightAnchor.constraint(equalToConstant: 230), marker.widthAnchor.constraint(equalToConstant: 100), marker.heightAnchor.constraint(equalToConstant: 70)])
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(field)
        NSApplication.shared.activate()
        print("fixture-ready"); fflush(stdout)
    }
    @objc func increment() { count += 1; counter.stringValue = "Count: \(count)" }
    @objc func scrolled(_ notification: Notification) {
        guard let clip = notification.object as? NSClipView else { return }
        scrollCounter.stringValue = "Scroll: \(Int(clip.bounds.origin.y))"
    }
}
@main struct Fixture {
    @MainActor static func main() {
        let app = NSApplication.shared; let delegate = FixtureDelegate(); app.delegate = delegate
        app.setActivationPolicy(.regular); app.run()
    }
}
