import AppKit
import ApplicationServices
import ScreenCaptureKit

nonisolated(unsafe) var cancellationRequested: sig_atomic_t = 0
func checkCancellation() throws {
    if cancellationRequested != 0 { throw ComputerError("cancelled", "Computer-use operation was cancelled.") }
}
/// Set by every input path the moment it reaches the target app; a request that fails before then
/// changed nothing, so its snapshot stays valid and the error reports `dispatchState: not_started`.
nonisolated(unsafe) var inputDispatched = false

struct ComputerError: Error {
    let code: String
    let message: String
    let dispatchState: String?
    init(_ code: String, _ message: String, dispatchState: String? = nil) { self.code = code; self.message = message; self.dispatchState = dispatchState }
}
struct InputStep: Decodable { let action: String; let text: String?; let key: String? }
struct Parameters: Decodable {
    var steps: [InputStep]?
    var activateFirst: Bool?
    var permission: String?
    var bundleId: String?
    var snapshotId: String?
    var elementId: String?
    var windowId: String?
    var includeScreenshot: Bool?
    var x: Double?
    var y: Double?
    var toX: Double?
    var toY: Double?
    var deltaX: Double?
    var deltaY: Double?
    var text: String?
    var value: String?
    var key: String?
    var button: String?
    var clickCount: Int?
    var accessibilityAction: String?
}
struct Request: Decodable { let id: String; let method: String; let params: Parameters }
func required<T>(_ value: T?, _ name: String) throws -> T {
    guard let value else { throw ComputerError("invalid_arguments", "Missing \(name).") }; return value
}
func axCheck(_ result: AXError) throws {
    guard result == .success else { throw ComputerError("accessibility_error", "Accessibility operation failed (\(result.rawValue)); observe the app again before retrying.") }
}
/// A press that opens a sheet, alert or modal panel holds the app's Accessibility reply until that UI
/// is up, so for a press `cannotComplete` after the messaging timeout means the request was delivered.
/// Any other failure may follow an effect, so it counts as dispatched unless Accessibility rejected the
/// request before the app saw it.
func dispatchAX(_ element: AXUIElement, press: Bool = false, _ operation: (AXUIElement) -> AXError) throws {
    AXUIElementSetMessagingTimeout(element, 2)
    let result = operation(element)
    if ![.illegalArgument, .attributeUnsupported, .actionUnsupported, .notImplemented, .apiDisabled].contains(result) { inputDispatched = true }
    if result == .success || result == .cannotComplete && press { return }
    try axCheck(result)
}
/// Some apps (Calendar on macOS 26) answer AXPress on a menu item by opening its menu with the item
/// highlighted instead of running it. Return runs the highlighted item, as it would for a keyboard user.
func completeMenuPress(_ item: AXUIElement, pid: pid_t) async throws {
    let submenu = (attribute(item, kAXChildrenAttribute) as? [AXUIElement] ?? []).contains { attribute($0, kAXRoleAttribute) as? String == kAXMenuRole }
    guard attribute(item, kAXRoleAttribute) as? String == kAXMenuItemRole, !submenu else { return }
    try await Task.sleep(for: .milliseconds(250))
    try checkCancellation()
    // A press that ran its item closes the item's menu (a closed menu has no height). Return runs the
    // highlighted item, so it is sent only while this item's own menu is open and the app highlights it.
    guard let rawMenu = attribute(item, kAXParentAttribute), CFGetTypeID(rawMenu) == AXUIElementGetTypeID(),
          case let menu = unsafeBitCast(rawMenu, to: AXUIElement.self), attribute(menu, kAXRoleAttribute) as? String == kAXMenuRole,
          (elementRect(menu)?.height ?? 0) > 0, attribute(item, kAXSelectedAttribute) as? Bool == true else { return }
    try postKey(pid: pid, code: 36)
}
/// A menu item's keyboard shortcut in macOS notation, such as ⌥⌘N, so the agent can use real shortcuts.
func menuShortcut(_ item: AXUIElement) -> String? {
    guard let char = attribute(item, "AXMenuItemCmdChar") as? String, !char.isEmpty, char.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7f }) else { return nil }
    let modifiers = (attribute(item, "AXMenuItemCmdModifiers") as? NSNumber)?.intValue ?? 0
    var text = ""
    if modifiers & 4 != 0 { text += "⌃" }
    if modifiers & 2 != 0 { text += "⌥" }
    if modifiers & 1 != 0 { text += "⇧" }
    if modifiers & 8 == 0 { text += "⌘" }
    return text + char
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func secure(_ element: AXUIElement) -> Bool {
    attribute(element, kAXSubroleAttribute) as? String == kAXSecureTextFieldSubrole
}
func requireNonSecure(_ element: AXUIElement) throws {
        var ancestor: AXUIElement? = element
        for _ in 0..<64 {
            try checkCancellation()
            guard let current = ancestor else { return }
            AXUIElementSetMessagingTimeout(current, 0.25)
            guard !secure(current) else { throw ComputerError("secure_element", "Secure input controls are unavailable to computer use.") }
            guard let parent = attribute(current, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return }
            ancestor = unsafeBitCast(parent, to: AXUIElement.self)
        }
        throw ComputerError("ancestry_unavailable", "Editor ancestry exceeds the safe traversal limit.")
}
func rectJSON(_ rect: CGRect) -> [String: Double] {
    ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
}
/// Whether keyboard focus is on `element` or an editor inside it, such as a combo box's field.
func holdsFocus(_ focused: CFTypeRef, _ element: AXUIElement) -> Bool {
    guard CFGetTypeID(focused) == AXUIElementGetTypeID() else { return false }
    var current: AXUIElement? = unsafeBitCast(focused, to: AXUIElement.self)
    for _ in 0..<8 {
        guard let candidate = current else { return false }
        if CFEqual(candidate, element) { return true }
        guard let parent = attribute(candidate, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
        current = unsafeBitCast(parent, to: AXUIElement.self)
    }
    return false
}
/// Whether typed characters land as text: a text, combo, date or time control (`AXDateTimeArea` is an
/// NSDatePicker's field), or anything with an editable text selection. Buttons, lists and web areas take characters as commands instead.
func takesText(_ element: AXUIElement) -> Bool {
    if [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, kAXDateFieldRole, kAXTimeFieldRole, "AXDateTimeArea"].contains(attribute(element, kAXRoleAttribute) as? String ?? "") { return true }
    var settable: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(element, kAXSelectedTextRangeAttribute as CFString, &settable) == .success && settable.boolValue
}
/// The window holding `element`: the element itself when it is a window or sheet, which report no
/// window of their own, otherwise the window it reports.
func containingWindow(_ element: AXUIElement) -> AXUIElement? {
    if [kAXWindowRole, kAXSheetRole].contains(attribute(element, kAXRoleAttribute) as? String ?? "") { return element }
    guard let raw = attribute(element, kAXWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(raw, to: AXUIElement.self)
}
func axActions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    return AXUIElementCopyActionNames(element, &names) == .success ? names as? [String] ?? [] : []
}
func elementRect(_ element: AXUIElement) -> CGRect? {
    guard let rawPosition = attribute(element, kAXPositionAttribute), CFGetTypeID(rawPosition) == AXValueGetTypeID(),
          let rawSize = attribute(element, kAXSizeAttribute), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return nil }
    var position = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(rawPosition, to: AXValue.self), .cgPoint, &position),
          AXValueGetValue(unsafeBitCast(rawSize, to: AXValue.self), .cgSize, &size) else { return nil }
    return CGRect(origin: position, size: size)
}
func appFor(_ bundleId: String?, launch: Bool = false) async throws -> NSRunningApplication {
    let bundle = try required(bundleId, "bundleId")
    guard bundle != Bundle.main.bundleIdentifier, !bundle.hasPrefix("com.simstudio."), !bundle.hasPrefix("ai.sim.desktop"), bundle != "com.apple.systempreferences" else {
        throw ComputerError("protected_app", "Computer use cannot control its own app or macOS security settings.")
    }
    var apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).filter { !$0.isTerminated }
    if apps.isEmpty && launch {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) else { throw ComputerError("app_unavailable", "No installed app matches this bundle ID.") }
        let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = false
        let app = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        guard app.bundleIdentifier == bundle, !app.isTerminated else { throw ComputerError("app_identity_mismatch", "Launched app identity does not match the requested bundle ID.") }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 0.1)
        var windowReady = false
        for _ in 0..<20 {
            try checkCancellation()
            if let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement], !windows.isEmpty { windowReady = true; break }
            guard !app.isTerminated else { throw ComputerError("app_unavailable", "App exited while opening its window.") }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard windowReady else { throw ComputerError("app_window_unavailable", "The app has not opened an accessible window yet. Observe it again after the window appears.") }
        apps = [app]
    }
    guard apps.count == 1, let app = apps.first else {
        throw ComputerError("app_unavailable", "Expected exactly one running app matching the bundle ID.")
    }
    guard app.processIdentifier != getppid() else { throw ComputerError("protected_app", "Computer use cannot control the desktop process that hosts its permission controls.") }
    return app
}
func requireAccessibility() throws {
    guard AXIsProcessTrusted() else { throw ComputerError("accessibility_permission_required", "Enable Accessibility for Mothership in System Settings, then retry.") }
}
func windowsFor(_ pid: pid_t) -> [[String: Any]] {
    guard let entries = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return entries.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
}
func windowRect(_ id: String?, pid: pid_t) throws -> CGRect {
    let id = try required(id, "windowId")
    guard let number = UInt32(id), let entry = windowsFor(pid).first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == number }),
          let bounds = entry[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 0, rect.height > 0 else {
        throw ComputerError("window_unavailable", "Window no longer belongs to the selected app; observe again.")
    }
    return rect
}
struct AXTraversalEntry<Element> {
    let element: Element
    let parent: Element?
    let depth: Int
    let menu: Bool
    let priority: Bool
}
struct AXTraversalQueue<Element> {
    private var priority: [AXTraversalEntry<Element>] = []
    private var content: [AXTraversalEntry<Element>] = []
    private var menus: [AXTraversalEntry<Element>] = []
    private var priorityIndex = 0
    private var contentIndex = 0
    private var menuIndex = 0
    private(set) var truncated = false
    let limit: Int
    init(limit: Int) { self.limit = limit }
    mutating func append(_ entry: AXTraversalEntry<Element>) {
        guard priority.count + content.count + menus.count < limit else { truncated = true; return }
        if entry.priority { priority.append(entry) }
        else if entry.menu { menus.append(entry) }
        else { content.append(entry) }
    }
    mutating func next() -> AXTraversalEntry<Element>? {
        if priorityIndex < priority.count { defer { priorityIndex += 1 }; return priority[priorityIndex] }
        if contentIndex < content.count { defer { contentIndex += 1 }; return content[contentIndex] }
        if menuIndex < menus.count { defer { menuIndex += 1 }; return menus[menuIndex] }
        return nil
    }
    var hasPending: Bool { priorityIndex < priority.count || contentIndex < content.count || menuIndex < menus.count }
}
func pagedElements(_ element: AXUIElement, name: String, limit: Int) -> ([AXUIElement], Bool) {
    var count = 0
    guard AXUIElementGetAttributeValueCount(element, name as CFString, &count) == .success, count > 0 else { return ([], false) }
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(element, name as CFString, 0, min(count, limit), &values) == .success else { return ([], true) }
    return (values as? [AXUIElement] ?? [], count > limit)
}
func ancestorPath(_ element: AXUIElement, to root: AXUIElement) throws -> [AXUIElement]? {
    var path: [AXUIElement] = []
    var current = element
    for _ in 0..<64 {
        try checkCancellation()
        AXUIElementSetMessagingTimeout(current, 0.1)
        guard !path.contains(where: { CFEqual($0, current) }) else { return nil }
        path.append(current)
        if CFEqual(current, root) { return path.reversed() }
        guard let parent = attribute(current, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return nil }
        current = unsafeBitCast(parent, to: AXUIElement.self)
    }
    return nil
}
final class Snapshot {
    let id = UUID().uuidString
    let pid: pid_t
    let launchDate: Date?
    let created = Date()
    var elements: [String: AXUIElement] = [:]
    var windowFrames: [String: CGRect] = [:]
    /// The Accessibility window behind each observed windowId, so input checks compare identity, not
    /// just bounds that two windows can share.
    var windowElements: [String: AXUIElement] = [:]
    /// The window this observation selected; coordinate input without a windowId targets it.
    var selectedWindowId: String?
    var nodes: [[String: Any]] = []
    var truncated = false
    init(app: NSRunningApplication) { pid = app.processIdentifier; launchDate = app.launchDate }
    func read(preferredWindowFrame: CGRect? = nil) async throws {
        try requireAccessibility()
        let root = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(root, 0.25)
        // Electron documents this attribute for external assistive technology.
        // Unsupported applications simply return attributeUnsupported; no OS permission is changed.
        if attribute(root, "AXManualAccessibility") as? Bool != true,
           AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success {
            try await Task.sleep(for: .milliseconds(100))
            try checkCancellation()
        }
        var queue = AXTraversalQueue<AXUIElement>(limit: 4000)
        queue.append(AXTraversalEntry(element: root, parent: nil, depth: 0, menu: false, priority: true))
        let (windows, windowsTruncated) = pagedElements(root, name: kAXWindowsAttribute, limit: 100)
        truncated = windowsTruncated
        var preferredWindow = windows.first
        if let preferredWindowFrame { preferredWindow = windows.first { elementRect($0) == preferredWindowFrame } }
        else if let raw = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() { preferredWindow = unsafeBitCast(raw, to: AXUIElement.self) }
        var paths: [[AXUIElement]] = []
        if let preferredWindow, let path = try ancestorPath(preferredWindow, to: root) { paths.append(path) }
        if let raw = attribute(root, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID(),
           let path = try ancestorPath(unsafeBitCast(raw, to: AXUIElement.self), to: root),
           preferredWindow == nil || path.contains(where: { CFEqual($0, preferredWindow!) }) {
            paths.append(path)
        }
        for path in paths {
            for (depth, element) in path.enumerated() {
                // Do not seed descendants of a secure input through the focused-element shortcut.
                if secure(element) { break }
                queue.append(AXTraversalEntry(element: element, parent: depth == 0 ? nil : path[depth - 1], depth: depth, menu: false, priority: true))
            }
        }
        // The menu bar's titles and any open menu come before window content, which can exhaust the budget.
        if let raw = attribute(root, kAXMenuBarAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() {
            queue.append(AXTraversalEntry(element: unsafeBitCast(raw, to: AXUIElement.self), parent: root, depth: 1, menu: false, priority: true))
        }
        var menuCount = 0
        while nodes.count < 2000 && Date().timeIntervalSince(created) < 8, let entry = queue.next() {
            try checkCancellation()
            let element = entry.element
            AXUIElementSetMessagingTimeout(element, 0.25)
            if elements.values.contains(where: { CFEqual($0, element) }) { continue }
            let role = attribute(element, kAXRoleAttribute) as? String ?? "AXUnknown"
            let isMenu = entry.menu || [kAXMenuBarRole, kAXMenuRole, kAXMenuItemRole, kAXMenuBarItemRole].contains(role)
            if role == kAXMenuItemRole && !entry.menu && !entry.priority {
                queue.append(AXTraversalEntry(element: element, parent: entry.parent, depth: entry.depth, menu: true, priority: false)); continue
            }
            if isMenu && !entry.priority {
                guard menuCount < 80 else { truncated = true; continue }
                menuCount += 1
            }
            let id = "e\(nodes.count)"; elements[id] = element
            var node: [String: Any] = ["elementId": id, "role": role, "actions": [String]()]
            if let parent = entry.parent, let parentID = elements.first(where: { CFEqual($0.value, parent) })?.key { node["parentId"] = parentID }
            let isSecure = secure(element)
            var labels = [kAXTitleAttribute, kAXDescriptionAttribute].compactMap { attribute(element, $0) as? String }.filter { !$0.isEmpty }
            if labels.isEmpty { labels = [kAXPlaceholderValueAttribute, kAXHelpAttribute].compactMap { attribute(element, $0) as? String }.filter { !$0.isEmpty } }
            if role == kAXMenuItemRole, let shortcut = menuShortcut(element) { labels.append(shortcut) }
            if !isSecure, !labels.isEmpty { node["label"] = String(labels.joined(separator: " ").prefix(1024)) }
            if !isSecure, let raw = attribute(element, kAXValueAttribute) {
                if let value = raw as? String { node["value"] = String(value.prefix(2048)) }
                else if let value = raw as? NSNumber { node["value"] = value.stringValue }
            }
            if !isSecure {
                if let focused = attribute(element, kAXFocusedAttribute) as? Bool { node["focused"] = focused }
                var writable: DarwinBoolean = false
                let writableValue = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &writable) == .success && writable.boolValue
                node["editable"] = [kAXTextAreaRole, kAXTextFieldRole].contains(role) && writableValue
                if let placeholder = attribute(element, kAXPlaceholderValueAttribute) as? String { node["placeholder"] = String(placeholder.prefix(1024)) }
            }
            if let enabled = attribute(element, kAXEnabledAttribute) as? Bool { node["enabled"] = enabled }
            if let rect = elementRect(element) { node.merge(rectJSON(rect)) { _, new in new } }
            var actions: CFArray?
            if AXUIElementCopyActionNames(element, &actions) == .success { node["actions"] = Array((actions as? [String] ?? []).prefix(128)).map { String($0.prefix(128)) } }
            nodes.append(node)
            if role == kAXWindowRole, let preferredWindow, !CFEqual(element, preferredWindow) { continue }
            if !isSecure, entry.depth < 64 {
                let (children, childrenTruncated) = pagedElements(element, name: kAXChildrenAttribute, limit: 500)
                truncated = truncated || childrenTruncated
                // An open menu's items and their submenus come first; a closed menu (no height) keeps its items last.
                let openMenu = role == kAXMenuRole ? (elementRect(element)?.height ?? 0) > 0 : isMenu && entry.priority
                let deferChildren = !openMenu && (entry.menu || role == kAXMenuRole)
                for child in children { queue.append(AXTraversalEntry(element: child, parent: element, depth: entry.depth + 1, menu: deferChildren, priority: openMenu)) }
            } else if entry.depth >= 64 { truncated = true }
        }
        if queue.hasPending || queue.truncated { truncated = true }
    }
    /// The observed windowId whose window holds `element`; a sheet counts as the window it is attached to.
    func windowId(holding element: AXUIElement) -> String? {
        guard var window = containingWindow(element) else { return nil }
        if attribute(window, kAXRoleAttribute) as? String == kAXSheetRole { guard let owner = sheetOwner(window) else { return nil }; window = owner }
        return windowElements.first { CFEqual($0.value, window) }?.key
    }
    func observedWindows() -> [(element: AXUIElement, frame: CGRect)] {
        windowFrames.compactMap { id, frame in windowElements[id].map { ($0, frame) } }
    }
    func element(_ id: String?) throws -> AXUIElement {
        let id = try required(id, "elementId")
        guard let element = elements[id], attribute(element, kAXRoleAttribute) != nil else { throw ComputerError("stale_element", "Element is stale; observe the app again.") }
        try requireNonSecure(element)
        return element
    }
}
func requireObservedFrame(_ observed: CGRect, current: CGRect) throws {
    guard observed == current else { throw ComputerError("stale_window", "Window geometry no longer matches this observation; observe again.") }
}
@available(macOS 14.0, *)
func screenshot(pid: pid_t, windowID: String, observedFrame: CGRect) async throws -> [String: Any] {
    guard CGPreflightScreenCaptureAccess() else { throw ComputerError("screen_capture_permission_required", "Enable Screen Recording for Mothership in System Settings, then retry.") }
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    guard let number = UInt32(windowID), let window = content.windows.first(where: { $0.windowID == number && $0.owningApplication?.processID == pid }) else { throw ComputerError("window_unavailable", "Selected window is unavailable for capture.") }
    let frame = try windowRect(windowID, pid: pid)
    try requireObservedFrame(observedFrame, current: frame)
    guard window.frame == frame else { throw ComputerError("stale_window", "Window moved before capture; observe again.") }
    let filter: SCContentFilter
    var legacyDisplay: SCDisplay?
    if #available(macOS 26.0, *) {
        filter = SCContentFilter(desktopIndependentWindow: window)
    } else {
        guard let display = content.displays.first(where: { $0.frame.contains(frame) }) else { throw ComputerError("capture_geometry_unavailable", "On this macOS version the selected window must fit within one display for a correctly aligned screenshot.") }
        legacyDisplay = display
        filter = SCContentFilter(display: display, including: [window])
    }
    let config = SCStreamConfiguration()
    let scale = min(CGFloat(filter.pointPixelScale), 1600 / max(frame.width, frame.height, 1))
    config.width = max(1, Int(frame.width * scale)); config.height = max(1, Int(frame.height * scale))
    config.showsCursor = false
    config.ignoreShadowsSingleWindow = true
    config.scalesToFit = true
    let image: CGImage
    if #available(macOS 26.0, *) {
        let screenshotConfig = SCScreenshotConfiguration()
        screenshotConfig.width = config.width; screenshotConfig.height = config.height
        screenshotConfig.showsCursor = false; screenshotConfig.ignoreShadows = true
        screenshotConfig.includeChildWindows = false
        let output = try await SCScreenshotManager.captureScreenshot(contentFilter: filter, configuration: screenshotConfig)
        guard let captured = output.sdrImage else { throw ComputerError("capture_failed", "Screenshot did not contain an SDR image.") }
        image = captured
    } else {
        guard let display = legacyDisplay else { throw ComputerError("capture_geometry_unavailable", "Capture display is unavailable.") }
        config.sourceRect = CGRect(x: frame.minX - display.frame.minX, y: frame.minY - display.frame.minY, width: frame.width, height: frame.height)
        config.ignoreShadowsDisplay = true
        image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }
    try requireObservedFrame(observedFrame, current: windowRect(windowID, pid: pid))
    guard image.width == config.width, image.height == config.height else { throw ComputerError("stale_window", "Window geometry changed during capture; observe again.") }
    guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]), data.count <= 8 * 1024 * 1024 else { throw ComputerError("capture_failed", "Screenshot encoding exceeded the allowed size.") }
    return ["base64": data.base64EncodedString(), "mimeType": "image/png", "width": image.width, "height": image.height]
}
func parseKey(_ key: String) throws -> (CGKeyCode, CGEventFlags) {
    let parts = key.lowercased().split(separator: "+").map(String.init)
            guard let name = parts.last else { throw ComputerError("invalid_arguments", "Key is empty.") }
            var flags: CGEventFlags = []
            for modifier in parts.dropLast() { switch modifier { case "cmd", "command", "meta", "super": flags.insert(.maskCommand); case "shift": flags.insert(.maskShift); case "alt", "option", "opt": flags.insert(.maskAlternate); case "ctrl", "control": flags.insert(.maskControl); default: throw ComputerError("invalid_arguments", "Unknown key modifier.") } }
            let keys: [String: CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"9":25,"7":26,"8":28,"0":29,"=":24,"-":27,"]":30,"[":33,"o":31,"u":32,"i":34,"p":35,"return":36,"enter":36,"l":37,"j":38,"'":39,";":41,"\\":42,",":43,"/":44,".":47,"`":50,"k":40,"n":45,"m":46,"tab":48,"space":49,"backspace":51,"escape":53,"delete":117,"left":123,"right":124,"down":125,"up":126,"home":115,"end":119,"pageup":116,"pagedown":121,"f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,"f9":101,"f10":109,"f11":103,"f12":111]
            let aliases = ["esc": "escape", "arrowleft": "left", "arrowright": "right", "arrowup": "up", "arrowdown": "down", "forwarddelete": "delete", "pgup": "pageup", "pgdn": "pagedown", "pgdown": "pagedown", "minus": "-", "equal": "=", "equals": "=", "comma": ",", "period": ".", "slash": "/", "semicolon": ";", "quote": "'", "backslash": "\\", "backtick": "`", "grave": "`", "leftbracket": "[", "rightbracket": "]"]
            guard let code = keys[aliases[name] ?? name] else { throw ComputerError("unsupported_key", "Unsupported key name. Use names such as Enter, Tab, Escape, Backspace, Delete (forward delete), Left, PageUp, F5, or a single character, with Cmd/Shift/Alt/Ctrl modifiers.") }; return (code, flags)
}
func validateInputSteps(_ steps: [InputStep]) throws {
    guard (1...32).contains(steps.count) else { throw ComputerError("invalid_arguments", "Input sequence requires 1 to 32 steps.") }
    var units = 0
    for step in steps {
        if step.action == "type_text" { units += try required(step.text, "text").utf16.count }
        else if step.action == "press_key" { _ = try parseKey(required(step.key, "key")) }
        else { throw ComputerError("invalid_arguments", "Sequence supports only type_text and press_key.") }
    }
    guard units <= 32000 else { throw ComputerError("invalid_arguments", "Combined text exceeds 32000 UTF-16 units.") }
}
func keyMayChangeFocus(_ key: String) throws -> Bool {
    let (code, flags) = try parseKey(key)
    return code == 48 || code == 53 || (flags.contains(.maskCommand) && ![CGKeyCode(0), 6, 8, 9, 7].contains(code))
}
func sendEditorKey(element: AXUIElement, pid: pid_t, code: CGKeyCode, flags: CGEventFlags) throws {
    if code == 0, flags == .maskCommand {
        var settable: DarwinBoolean = false
        if AXUIElementIsAttributeSettable(element, kAXSelectedTextRangeAttribute as CFString, &settable) == .success, settable.boolValue, let value = attribute(element, kAXValueAttribute) as? String {
            var range = CFRange(location: 0, length: value.utf16.count)
            if let selected = AXValueCreate(.cfRange, &range) { try dispatchAX(element) { AXUIElementSetAttributeValue($0, kAXSelectedTextRangeAttribute as CFString, selected) }; return }
        }
    }
    try postKey(pid: pid, code: code, flags: flags)
}
func postKey(pid: pid_t, code: CGKeyCode, flags: CGEventFlags = [], text: String? = nil) throws {
    guard let source = CGEventSource(stateID: .privateState), let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true), let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { throw ComputerError("input_failed", "Could not create keyboard event.") }
    down.flags = flags; up.flags = flags
    if let text { let chars = Array(text.utf16); chars.withUnsafeBufferPointer { down.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: $0.baseAddress) } }
    inputDispatched = true
    down.postToPid(pid); up.postToPid(pid)
}
func mapPoint(frame: CGRect, x: Double, y: Double) throws -> CGPoint {
    guard x.isFinite, y.isFinite, x >= 0, y >= 0, x < frame.width, y < frame.height else { throw ComputerError("invalid_coordinates", "Coordinates must lie within the selected window in points.") }
    return CGPoint(x: frame.minX + x, y: frame.minY + y)
}
func requireForegroundTarget(pid: pid_t, windowID: String, window: AXUIElement, point: CGPoint, frame: CGRect) throws {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { throw ComputerError("foreground_required", "Coordinate mouse input requires the target app in front. Call activate_app, then observe again.") }
    guard try windowRect(windowID, pid: pid) == frame else { throw ComputerError("stale_window", "Window moved during input; observe it again.") }
    guard let hit = elementAtPoint(point) else { throw ComputerError("window_occluded", "Cannot confirm which window receives this point; observe again before retrying.") }
    var owner: pid_t = 0
    guard AXUIElementGetPid(hit, &owner) == .success, owner == pid else { throw ComputerError("window_occluded", "The target point is covered by another app's window; bring the intended window forward and observe again.") }
    // The point must belong to the observed window (its sheets and popovers report it as their window),
    // to one of the app's dialogs or floating panels above it, or to an open menu, which has no window.
    // Anything unconfirmed is refused.
    if let hitWindow = containingWindow(hit) {
        guard acceptsInput(hitWindow, observed: [(window, frame)]) else {
            throw ComputerError("window_occluded", "Another of this app's windows covers the target point; observe that window and target it instead.")
        }
    } else if ![kAXMenuRole, kAXMenuItemRole, kAXMenuBarRole, kAXMenuBarItemRole].contains(attribute(hit, kAXRoleAttribute) as? String ?? "") {
        // Out-of-process panels (open and save) expose their contents without a window; they are
        // reachable only inside the app's focused sheet, which must belong to the observed window.
        let root = AXUIElementCreateApplication(pid)
        guard let rawSheet = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(rawSheet) == AXUIElementGetTypeID(),
              case let sheet = unsafeBitCast(rawSheet, to: AXUIElement.self), attribute(sheet, kAXRoleAttribute) as? String == kAXSheetRole,
              elementRect(sheet)?.contains(point) == true, acceptsInput(sheet, observed: [(window, frame)]) else {
            throw ComputerError("window_occluded", "Cannot confirm which window receives this point; observe again before retrying.")
        }
    }
}
/// The window a sheet is attached to: its parent, or for an out-of-process panel that reports no
/// parent, the window it reports as its own.
func sheetOwner(_ sheet: AXUIElement) -> AXUIElement? {
    for name in [kAXParentAttribute, kAXWindowAttribute] {
        if let raw = attribute(sheet, name), CFGetTypeID(raw) == AXUIElementGetTypeID() {
            let owner = unsafeBitCast(raw, to: AXUIElement.self)
            if attribute(owner, kAXRoleAttribute) as? String == kAXWindowRole { return owner }
        }
    }
    return nil
}
/// Whether input aimed at an observed window may go to `window`: the observed window itself, or one of
/// the app's dialogs or floating panels above it. Another document window, or one whose kind cannot be
/// read, is refused.
func acceptsInput(_ window: AXUIElement, observed: [(element: AXUIElement, frame: CGRect)]) -> Bool {
    if observed.contains(where: { CFEqual($0.element, window) && elementRect(window) == $0.frame }) { return true }
    // A sheet (Go to Folder, an open or save panel) belongs to the window it is attached to.
    if attribute(window, kAXRoleAttribute) as? String == kAXSheetRole { return sheetOwner(window).map { acceptsInput($0, observed: observed) } ?? false }
    let auxiliary: Set<String> = [kAXDialogSubrole, kAXSystemDialogSubrole, kAXFloatingWindowSubrole, kAXSystemFloatingWindowSubrole]
    return (attribute(window, kAXSubroleAttribute) as? String).map(auxiliary.contains) ?? false
}
/// The element that receives a click at a global point. Notification Center and the Dock keep
/// full-screen click-through windows above every app, so the topmost window in the window list is not
/// the click target; Accessibility hit-testing follows the window server's routing. Without an answer
/// the target is unknown, and the caller refuses the input.
func elementAtPoint(_ point: CGPoint) -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 0.25)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success else { return nil }
    return hit
}
final class CoordinateDispatch {
    private(set) var hasDispatched = false
    func willDispatch() { hasDispatched = true; inputDispatched = true }
    func classify(_ error: ComputerError) -> ComputerError {
        ComputerError(error.code, error.message, dispatchState: hasDispatched ? nil : "not_started")
    }
}
@MainActor
func coordinateAction(_ operation: (CoordinateDispatch) async throws -> Void) async throws {
    let dispatch = CoordinateDispatch()
    do { try await operation(dispatch) }
    catch let error as ComputerError { throw dispatch.classify(error) }
}
func postMouse(pid: pid_t, type: CGEventType, point: CGPoint, button: CGMouseButton, count: Int = 1, windowID: String? = nil, window: AXUIElement? = nil, frame: CGRect? = nil, release: Bool = false, dispatch: CoordinateDispatch) throws {
    guard let windowID, let frame else { throw ComputerError("invalid_window", "Mouse input requires an observed app window.") }
    if !release {
        guard let window else { throw ComputerError("invalid_window", "Mouse input requires an observed app window.") }
        try requireForegroundTarget(pid: pid, windowID: windowID, window: window, point: point, frame: frame)
    }
    guard let source = CGEventSource(stateID: .privateState), let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button) else { throw ComputerError("input_failed", "Could not create mouse event.") }
    event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
    dispatch.willDispatch()
    event.post(tap: .cghidEventTap)
}

func discoverApps() throws -> [[String: Any]] {
    var entries: [String: [String: Any]] = [:]
    let roots = [URL(fileURLWithPath: "/Applications"), URL(fileURLWithPath: "/System/Applications"), FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
    var inspected = 0
    scanRoots: for root in roots {
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else { continue }
        for case let url as URL in enumerator {
            try checkCancellation()
            if inspected >= 5000 || entries.count >= 1000 { break scanRoots }
            inspected += 1
            if url.pathExtension == "app" {
                enumerator.skipDescendants()
                guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier, id.utf8.count <= 255 else { continue }
                let name = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? url.deletingPathExtension().lastPathComponent
                entries[id] = ["bundleId": id, "name": String(name.prefix(1024)), "isActive": false]
            } else if enumerator.level >= 3 { enumerator.skipDescendants() }
        }
    }
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        guard let id = app.bundleIdentifier, id.utf8.count <= 255 else { continue }
        entries[id] = ["bundleId": id, "name": String((app.localizedName ?? id).prefix(1024)), "pid": app.processIdentifier, "isActive": app.isActive]
    }
    return Array(entries.values.sorted { ($0["bundleId"] as? String ?? "") < ($1["bundleId"] as? String ?? "") }.prefix(1000))
}
@MainActor
final class Driver {
    var snapshots: [String: Snapshot] = [:]
    func point(_ p: Parameters, app: NSRunningApplication, snapshot: Snapshot, end: Bool = false) throws -> CGPoint {
        if let elementId = p.elementId, !end {
            guard let frame = elementRect(try snapshot.element(elementId)) else { throw ComputerError("element_unavailable", "Element has no usable frame.") }
            return CGPoint(x: frame.midX, y: frame.midY)
        }
        let windowId = try required(p.windowId ?? snapshot.selectedWindowId, "windowId")
        let frame = try windowRect(windowId, pid: app.processIdentifier)
        guard snapshot.windowFrames[windowId] == frame else { throw ComputerError("stale_window", "Window moved or changed; observe it again.") }
        let x = try required(end ? p.toX : p.x, end ? "toX" : "x"); let y = try required(end ? p.toY : p.y, end ? "toY" : "y")
        let position = try mapPoint(frame: frame, x: x, y: y)
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 0.25)
        var target: AXUIElement?
        if AXUIElementCopyElementAtPosition(root, Float(position.x), Float(position.y), &target) == .success, let target { try requireNonSecure(target) }
        return position
    }
    func activate(_ app: NSRunningApplication) async throws {
        guard app.activate(options: []) else { throw ComputerError("activation_failed", "macOS did not accept app activation.") }
        for _ in 0..<20 {
            try checkCancellation()
            if app.isActive { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw ComputerError("activation_failed", "App did not become active; observe before retrying.")
    }
    func execute(_ request: Request) async throws -> [String: Any] {
        try checkCancellation()
        let p = request.params
        switch request.method {
        case "diagnose_screen_capture":
            guard #available(macOS 14.0, *) else { throw ComputerError("unsupported_os", "ScreenCaptureKit requires macOS 14.") }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            _ = content
            return ["kind": "status", "platform": "darwin", "accessibility": AXIsProcessTrusted(), "screenRecording": true]
        case "request_permission":
            switch p.permission {
            case "accessibility":
                let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
            case "screenCapture": _ = CGRequestScreenCaptureAccess()
            default: throw ComputerError("invalid_arguments", "Unknown permission.")
            }
            return ["kind": "status", "platform": "darwin", "accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]
        case "status": return ["kind": "status", "platform": "darwin", "accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]
        case "list_apps": return ["kind": "apps", "apps": try discoverApps()]
        case "activate_app":
            try requireAccessibility()
            let app = try await appFor(p.bundleId, launch: true)
            try await activate(app)
            snapshots.removeValue(forKey: app.bundleIdentifier!)
            return ["kind": "action", "action": "activate_app", "bundleId": app.bundleIdentifier!, "dispatched": true, "verified": true]
        case "get_app_state":
            try requireAccessibility()
            let app = try await appFor(p.bundleId, launch: true); let snapshot = Snapshot(app: app)
            let preferredFrame = try p.windowId.map { try windowRect($0, pid: app.processIdentifier) }
            try await snapshot.read(preferredWindowFrame: preferredFrame)
            let axWindows = snapshot.elements.values.filter { attribute($0, kAXRoleAttribute) as? String == kAXWindowRole }
            let axWindowFrames = axWindows.compactMap(elementRect)
            let entries = windowsFor(app.processIdentifier).prefix(100)
            func bounds(_ entry: [String: Any]) -> CGRect? { (entry[kCGWindowBounds as String] as? [String: Any]).flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) } }
            func onScreen(_ entry: [String: Any]) -> Bool { entry[kCGWindowIsOnscreen as String] as? Bool == true }
            // A background tab is an off-screen window with the bounds of the tab in front, which is the
            // only one Accessibility shows, so it can be neither observed nor targeted.
            let onScreenRects = entries.filter(onScreen).compactMap(bounds)
            let windows = entries.compactMap { entry -> [String: Any]? in
                guard let id = entry[kCGWindowNumber as String] as? NSNumber, let rect = bounds(entry), rect.width > 0, rect.height > 0, axWindowFrames.contains(rect), onScreen(entry) || !onScreenRects.contains(rect) else { return nil }
                snapshot.windowFrames[id.stringValue] = rect
                // Public APIs match a window-list entry to its Accessibility window only by bounds; when
                // two windows share bounds that match is ambiguous, so neither gets an identity and
                // input aimed at either is refused. An off-screen (minimized) window takes no input either.
                let matches = axWindows.filter { elementRect($0) == rect }
                if matches.count == 1, onScreen(entry) { snapshot.windowElements[id.stringValue] = matches[0] }
                var result: [String: Any] = ["windowId": id.stringValue, "title": entry[kCGWindowName as String] as? String ?? ""]
                if let title = result["title"] as? String { result["title"] = String(title.prefix(4096)) }
                result.merge(rectJSON(rect)) { _, new in new }; return result
            }
            if snapshots.count >= 16 { snapshots.removeAll() }
            snapshots[app.bundleIdentifier!] = snapshot
            let root = AXUIElementCreateApplication(app.processIdentifier)
            let focusedID = attribute(root, kAXFocusedWindowAttribute).flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? snapshot.windowId(holding: unsafeBitCast($0, to: AXUIElement.self)) : nil }
            for index in snapshot.nodes.indices {
                if let element = snapshot.elements[snapshot.nodes[index]["elementId"] as? String ?? ""], attribute(element, kAXRoleAttribute) as? String == kAXWindowRole, let windowID = snapshot.windowId(holding: element) { snapshot.nodes[index]["windowId"] = windowID }
                else if let parentID = snapshot.nodes[index]["parentId"] as? String, let parent = snapshot.nodes.first(where: { $0["elementId"] as? String == parentID }), let windowID = parent["windowId"] as? String { snapshot.nodes[index]["windowId"] = windowID }
            }
            guard let selectedWindowId = p.windowId ?? focusedID ?? windows.first?["windowId"] as? String else { throw ComputerError("app_window_unavailable", "No accessible app window is available. Open a window, then observe the app again.") }
            guard snapshot.windowFrames[selectedWindowId] != nil else { throw ComputerError("window_unavailable", "Selected window does not belong to the app.") }
            snapshot.selectedWindowId = selectedWindowId
            var result: [String: Any] = ["kind": "state", "windowId": selectedWindowId, "snapshotId": snapshot.id, "bundleId": app.bundleIdentifier!, "nodes": snapshot.nodes, "windows": windows, "truncated": snapshot.truncated]
            if p.includeScreenshot == true {
                do {
                    guard #available(macOS 14.0, *) else { throw ComputerError("unsupported_os", "Screenshots require macOS 14 or later.") }
                    result["screenshot"] = try await screenshot(pid: app.processIdentifier, windowID: selectedWindowId, observedFrame: try required(snapshot.windowFrames[selectedWindowId], "observed window frame"))
                } catch let error as ComputerError { result["screenshotError"] = String((error.code + ": " + error.message).prefix(2000)) }
                catch { result["screenshotError"] = String(("capture_failed: " + String(describing: error)).prefix(2000)) }
            }
            result["isActive"] = app.isActive
            return result
        case "click", "type_text", "input_sequence", "press_key", "scroll", "drag", "set_value", "perform_action": break
        default: throw ComputerError("unknown_method", "Unknown computer-use method.")
        }
        try requireAccessibility()
        let app = try await appFor(p.bundleId); let bundle = try required(app.bundleIdentifier, "bundleId")
        guard let snapshot = snapshots[bundle], snapshot.id == p.snapshotId, snapshot.pid == app.processIdentifier, snapshot.launchDate == app.launchDate, Date().timeIntervalSince(snapshot.created) < 60 else { throw ComputerError("stale_snapshot", "Observe the app again before acting.") }
        inputDispatched = false
        do {
            let result = try await act(request, app: app, bundle: bundle, snapshot: snapshot)
            snapshots.removeValue(forKey: bundle)
            return result
        } catch let error as ComputerError {
            // Input that reached the app may have changed it, so only an untouched app keeps its references.
            if inputDispatched { snapshots.removeValue(forKey: bundle); throw error }
            // Only a malformed or unsupported request leaves the observation itself usable.
            let requestError = ["invalid_arguments", "invalid_coordinates", "invalid_window", "unsupported_action", "unsupported_key", "element_unavailable", "secure_element"].contains(error.code)
            throw ComputerError(error.code, error.message + (requestError ? " Nothing was sent to the app; this snapshot is still valid." : ""), dispatchState: "not_started")
        } catch {
            snapshots.removeValue(forKey: bundle); throw error
        }
    }
    func act(_ request: Request, app: NSRunningApplication, bundle: String, snapshot: Snapshot) async throws -> [String: Any] {
        let p = request.params
        let pid = app.processIdentifier
        switch request.method {
        case "perform_action":
            let element = try snapshot.element(p.elementId); let action = try required(p.accessibilityAction, "accessibilityAction")
            var names: CFArray?; try axCheck(AXUIElementCopyActionNames(element, &names))
            guard (names as? [String] ?? []).contains(action) else { throw ComputerError("unsupported_action", "Action was not advertised by the selected element.") }
            // Actions that open UI (a sheet, a menu) hold the reply like a press; others fail as uncertain on timeout.
            let opensUI = [kAXPressAction, kAXPickAction, kAXShowMenuAction].contains(action)
            try dispatchAX(element, press: opensUI) { AXUIElementPerformAction($0, action as CFString) }
            if action == kAXPressAction || action == kAXPickAction { try await completeMenuPress(element, pid: pid) }
        case "set_value":
            let element = try snapshot.element(p.elementId); let value = try required(p.value, "value")
            guard value.utf16.count <= 32000 else { throw ComputerError("invalid_arguments", "Value exceeds 32000 UTF-16 units.") }
            var writable: DarwinBoolean = false; try axCheck(AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &writable))
            guard writable.boolValue else { throw ComputerError("unsupported_action", "This element does not support setting its value; click it and use type_text instead.") }
            try dispatchAX(element) { AXUIElementSetAttributeValue($0, kAXValueAttribute as CFString, value as CFString) }
        case "click":
            let button = p.button ?? "left"; let count = p.clickCount ?? 1
            guard ["left", "right"].contains(button), (1...3).contains(count) else { throw ComputerError("invalid_arguments", "Invalid button or clickCount.") }
            if p.elementId != nil && button == "left" && count == 1, let element = try? snapshot.element(p.elementId), axActions(element).contains(kAXPressAction) {
                try dispatchAX(element, press: true) { AXUIElementPerformAction($0, kAXPressAction as CFString) }
                try await completeMenuPress(element, pid: pid)
            } else {
                try await coordinateAction { dispatch in
                    let position = try point(p, app: app, snapshot: snapshot); let mouse: CGMouseButton = button == "right" ? .right : .left
                    // Coordinates are window-local to the requested (or selected) window. An element targets its
                    // own window; an out-of-process panel's content reports none and the selected window's sheet check applies.
                    let windowID = try required(p.windowId ?? p.elementId.flatMap { snapshot.windowId(holding: try snapshot.element($0)) } ?? snapshot.selectedWindowId, "windowId")
                    let frame = try required(snapshot.windowFrames[windowID], "window frame")
                    for click in 1...count {
                        try checkCancellation()
                        try postMouse(pid: pid, type: button == "right" ? .rightMouseDown : .leftMouseDown, point: position, button: mouse, count: click, windowID: windowID, window: snapshot.windowElements[windowID], frame: frame, dispatch: dispatch)
                        try postMouse(pid: pid, type: button == "right" ? .rightMouseUp : .leftMouseUp, point: position, button: mouse, count: click, windowID: windowID, window: snapshot.windowElements[windowID], frame: frame, release: true, dispatch: dispatch)
                    }
                }
            }
        case "type_text", "input_sequence":
            let element = try snapshot.element(p.elementId)
            let steps = request.method == "type_text" ? [InputStep(action: "type_text", text: try required(p.text, "text"), key: nil)] : try required(p.steps, "steps")
            try validateInputSteps(steps)
            let root = AXUIElementCreateApplication(pid)
            // Keystrokes go to whatever holds keyboard focus: a text control (terminals included, read-only
            // or not), or a container whose focused editor already holds it, such as a web composer.
            let targetTakesText = takesText(element)
            guard targetTakesText || attribute(root, kAXFocusedUIElementAttribute).map({ holdsFocus($0, element) }) == true else {
                throw ComputerError("unsupported_action", "This element does not take text. Type into a text field, text area, combo box or date field, or use press_key for shortcuts.")
            }
            if request.method == "input_sequence", p.activateFirst == true { try await activate(app) }
            // Activation can move focus, so whether the editor holds it is read after activating.
            if attribute(root, kAXFocusedUIElementAttribute).map({ holdsFocus($0, element) }) != true {
                try axCheck(AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue))
                try await Task.sleep(for: .milliseconds(50))
            }
            let observedWindows = snapshot.observedWindows()
            // The first editor found holding focus receives the whole input, so text never follows focus elsewhere.
            var editor: AXUIElement?
            func validateFocus() throws {
                try checkCancellation(); try requireNonSecure(element)
                // The editor must still sit in an observed window (or a dialog above it) at the observed frame.
                guard let window = containingWindow(element), acceptsInput(window, observed: observedWindows) else {
                    throw ComputerError("stale_window", "The editor's window moved or is not an observed window; observe again.")
                }
                guard let current = attribute(root, kAXFocusedUIElementAttribute), holdsFocus(current, element), editor.map({ CFEqual($0, current) }) ?? true else { throw ComputerError("focus_changed", "The exact editor is no longer focused; remaining input was not dispatched. Observe again.") }
                // Keystrokes land on the focused element, so it (or the text control targeted) must take text.
                let receiver = unsafeBitCast(current, to: AXUIElement.self)
                try requireNonSecure(receiver)
                guard targetTakesText || takesText(receiver) else { throw ComputerError("unsupported_action", "Keyboard focus is not in a text input; no text was sent. Click into the text field, or use press_key for shortcuts.") }
                editor = receiver
            }
            // AX focus requests and app activation may settle asynchronously. Wait without
            // posting input or requesting focus again; every eventual input keeps the same guard.
            for attempt in 0..<10 {
                do { try validateFocus(); break }
                catch let error as ComputerError where error.code == "focus_changed" {
                    if attempt < 9 { try await Task.sleep(for: .milliseconds(50)) }
                    else if !app.isActive { throw ComputerError("activation_required", "No input was dispatched. This background app does not expose the exact keyboard focus target. Call activate_app for this bundle, then get_app_state and retry using the fresh editor reference.", dispatchState: "not_started") }
                    else { throw error }
                }
            }
            try validateFocus()
            var completed = 0
            var dispatched = false
            do {
                for step in steps {
                    try validateFocus()
                    if step.action == "type_text" {
                        for character in step.text! {
                            try validateFocus()
                            dispatched = true
                            try postKey(pid: pid, code: 0, text: String(character))
                        }
                    } else {
                        let (code, flags) = try parseKey(step.key!)
                        dispatched = true
                        try sendEditorKey(element: element, pid: pid, code: code, flags: flags)
                    }
                    completed += 1
                    if completed < steps.count, step.action == "press_key", try keyMayChangeFocus(step.key!) {
                        throw ComputerError("focus_changed", "A focus-changing key ended the sequence; remaining input was not dispatched.")
                    }
                    try await Task.sleep(for: .milliseconds(80))
                }
            } catch {
                if request.method != "input_sequence" || !dispatched { throw error }
                let message = (error as? ComputerError)?.message ?? "Input interrupted; current step outcome is unknown."
                return ["kind": "action", "action": request.method, "bundleId": bundle, "dispatched": true, "verified": false, "sequence": ["completedSteps": completed, "totalSteps": steps.count, "error": message + " Do not retry the sequence; observe the app first."]]
            }
            if request.method == "input_sequence" { return ["kind": "action", "action": request.method, "bundleId": bundle, "dispatched": true, "verified": false, "sequence": ["completedSteps": completed, "totalSteps": steps.count]] }
        case "press_key":
            // Without a windowId the key goes to whichever observed window has focus.
            let frame = try p.windowId.map { windowId in
                let frame = try windowRect(windowId, pid: pid)
                guard snapshot.windowFrames[windowId] == frame else { throw ComputerError("stale_window", "Observe the target window again.") }
                return frame
            }
            let root = AXUIElementCreateApplication(pid)
            // A targeted key first moves keyboard focus to that element, as clicking into it would.
            if let elementId = p.elementId {
                let element = try snapshot.element(elementId)
                if attribute(root, kAXFocusedUIElementAttribute).map({ holdsFocus($0, element) }) != true {
                    try axCheck(AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue))
                }
                // Focus can settle asynchronously; the key is sent only once this element holds it.
                var focused = false
                for _ in 0..<10 {
                    try checkCancellation()
                    if attribute(root, kAXFocusedUIElementAttribute).map({ holdsFocus($0, element) }) == true { focused = true; break }
                    try await Task.sleep(for: .milliseconds(50))
                }
                guard focused else { throw ComputerError("focus_changed", "The element did not take keyboard focus; no key was sent. Observe again.") }
            }
            // Keys go to the app's key window: the observed window, or a dialog, panel or popover above it,
            // but never another document window the snapshot did not observe.
            guard let rawWindow = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(rawWindow) == AXUIElementGetTypeID() else { throw ComputerError("focus_failed", "The app has no focused window to receive keys; click a window or call activate_app, then observe again.") }
            let focusedWindow = unsafeBitCast(rawWindow, to: AXUIElement.self)
            let targets: [(element: AXUIElement, frame: CGRect)]
            if let windowId = p.windowId, let frame { targets = snapshot.windowElements[windowId].map { [($0, frame)] } ?? [] }
            else { targets = snapshot.observedWindows() }
            guard acceptsInput(focusedWindow, observed: targets) else { throw ComputerError("focus_failed", "Another document window has keyboard focus; observe that window and target it instead.") }
            if let focused = attribute(root, kAXFocusedUIElementAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() { try requireNonSecure(unsafeBitCast(focused, to: AXUIElement.self)) }
            let (code, flags) = try parseKey(required(p.key, "key"))
            var selectedAll = false
            if code == 0, flags == .maskCommand, let rawFocused = attribute(root, kAXFocusedUIElementAttribute), CFGetTypeID(rawFocused) == AXUIElementGetTypeID() {
                let element = unsafeBitCast(rawFocused, to: AXUIElement.self)
                var settable: DarwinBoolean = false
                if AXUIElementIsAttributeSettable(element, kAXSelectedTextRangeAttribute as CFString, &settable) == .success, settable.boolValue, let value = attribute(element, kAXValueAttribute) as? String {
                    var range = CFRange(location: 0, length: value.utf16.count)
                    if let selectedRange = AXValueCreate(.cfRange, &range) { try dispatchAX(element) { AXUIElementSetAttributeValue($0, kAXSelectedTextRangeAttribute as CFString, selectedRange) }; selectedAll = true }
                }
            }
            if !selectedAll { try postKey(pid: pid, code: code, flags: flags) }
        case "scroll":
            try await coordinateAction { dispatch in
                let position = try point(p, app: app, snapshot: snapshot); let dx = p.deltaX ?? 0; let dy = p.deltaY ?? 0
                guard dx.isFinite, dy.isFinite, abs(dx) <= 10000, abs(dy) <= 10000 else { throw ComputerError("invalid_arguments", "Scroll deltas exceed bounds.") }
                guard let event = CGEvent(scrollWheelEvent2Source: CGEventSource(stateID: .privateState), units: .pixel, wheelCount: 2, wheel1: Int32(-dy), wheel2: Int32(-dx), wheel3: 0) else { throw ComputerError("input_failed", "Could not create scroll event.") }
                // Coordinates are window-local to the requested (or selected) window; an element targets its own.
                let windowID = try required(p.windowId ?? p.elementId.flatMap { snapshot.windowId(holding: try snapshot.element($0)) } ?? snapshot.selectedWindowId, "windowId")
                let frame = try required(snapshot.windowFrames[windowID], "window frame")
                try requireForegroundTarget(pid: pid, windowID: windowID, window: try required(snapshot.windowElements[windowID], "observed window"), point: position, frame: frame)
                event.location = position; dispatch.willDispatch(); event.post(tap: .cghidEventTap)
            }
        case "drag":
            try await coordinateAction { dispatch in
                let start = try point(p, app: app, snapshot: snapshot); let end = try point(p, app: app, snapshot: snapshot, end: true)
                let windowID = try required(p.windowId ?? snapshot.selectedWindowId, "windowId"); let frame = try required(snapshot.windowFrames[windowID], "window frame")
                try postMouse(pid: pid, type: .leftMouseDown, point: start, button: .left, windowID: windowID, window: snapshot.windowElements[windowID], frame: frame, dispatch: dispatch)
                var lastPoint = start
                defer { try? postMouse(pid: pid, type: .leftMouseUp, point: lastPoint, button: .left, windowID: windowID, window: snapshot.windowElements[windowID], frame: frame, release: true, dispatch: dispatch) }
                try await Task.sleep(for: .milliseconds(10))
                for step in 1...10 {
                    try checkCancellation()
                    let amount = CGFloat(step) / 10
                    let position = CGPoint(x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount)
                    try postMouse(pid: pid, type: .leftMouseDragged, point: position, button: .left, windowID: windowID, window: snapshot.windowElements[windowID], frame: frame, dispatch: dispatch)
                    lastPoint = position
                    try await Task.sleep(for: .milliseconds(10))
                }
            }
        default: throw ComputerError("unknown_method", "Unknown method.")
        }
        // Give the app a moment to render the result so the follow-up observation shows it.
        try await Task.sleep(for: .milliseconds(200))
        return ["kind": "action", "action": request.method, "bundleId": bundle, "dispatched": true, "verified": false]
    }
}
func nextLine() throws -> String? {
    var bytes = [UInt8](); bytes.reserveCapacity(4096)
    var oversized = false
    while true {
        let value = getchar()
        if value == EOF { if bytes.isEmpty && !oversized { return nil }; break }
        if value == 10 { break }
        if bytes.count < 128 * 1024 { bytes.append(UInt8(value)) } else { oversized = true }
    }
    if oversized { throw ComputerError("invalid_request", "Request exceeds 128 KiB.") }
    guard let line = String(bytes: bytes, encoding: .utf8) else { throw ComputerError("invalid_request", "Request is not UTF-8.") }
    return line
}
// The receiver accepts at most 16 MiB per JSON line, including the result envelope.
func encodeReply(_ response: [String: Any]) throws -> Data {
    let limit = 16 * 1024 * 1024
    func encode(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
    let original = try encode(response)
    if original.count <= limit { return original }
    if var result = response["result"] as? [String: Any] {
        let nested = result["kind"] as? String == "action"
        if var state = nested ? result["observation"] as? [String: Any] : result,
           state["kind"] as? String == "state" {
            state["truncated"] = true
            if state.removeValue(forKey: "screenshot") != nil {
                state["screenshotError"] = "Screenshot omitted to fit the native reply size limit."
            }
            func reply(_ snapshot: [String: Any]) throws -> Data {
                var envelope = response
                if nested { result["observation"] = snapshot; envelope["result"] = result }
                else { envelope["result"] = snapshot }
                return try encode(envelope)
            }
            let withoutImage = try reply(state)
            if withoutImage.count <= limit { return withoutImage }
            if let nodes = state["nodes"] as? [[String: Any]] {
                var low = 0; var high = nodes.count
                state["nodes"] = [] as [[String: Any]]
                var best = try reply(state)
                while low < high {
                    let count = (low + high + 1) / 2
                    let prefix = Array(nodes.prefix(count))
                    let ids = Set(prefix.compactMap { $0["elementId"] as? String })
                    state["nodes"] = prefix.map { node in
                        var kept = node
                        if let parent = kept["parentId"] as? String, !ids.contains(parent) { kept.removeValue(forKey: "parentId") }
                        return kept
                    }
                    let encoded = try reply(state)
                    if encoded.count <= limit { low = count; best = encoded }
                    else { high = count - 1 }
                }
                if best.count <= limit { return best }
            }
        }
        if nested {
            result.removeValue(forKey: "observation")
            result["observationError"] = "Observation omitted to fit the native reply size limit."
            var envelope = response; envelope["result"] = result
            let encoded = try encode(envelope)
            if encoded.count <= limit { return encoded }
        }
    }
    return try encode(["id": response["id"] ?? "invalid-request", "error": ["code": "response_too_large", "message": "Native reply exceeded its size limit; inspect the app before repeating an action."]])
}
#if !COMPUTER_USE_TEST
@main
struct Main {
    @MainActor static func main() async {
        signal(SIGTERM) { _ in cancellationRequested = 1 }
        signal(SIGINT) { _ in cancellationRequested = 1 }
        let driver = Driver()
        while cancellationRequested == 0 {
            var id = "invalid-request"
            var response: [String: Any]
            do {
                guard let line = try nextLine() else { break }
                let request = try JSONDecoder().decode(Request.self, from: Data(line.utf8)); id = request.id
                guard !id.isEmpty, id.utf8.count <= 128 else { throw ComputerError("invalid_request", "Request ID must contain 1 to 128 bytes.") }
                response = ["id": id, "result": try await driver.execute(request)]
            } catch let error as ComputerError {
                var details: [String: Any] = ["code": error.code, "message": error.message]
                if let dispatchState = error.dispatchState { details["dispatchState"] = dispatchState }
                response = ["id": id, "error": details]
            }
            catch { response = ["id": id, "error": ["code": "request_failed", "message": String(String(describing: error).prefix(2000))]] }
            if let data = try? encodeReply(response) {
                FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
            }
        }
    }
}

#endif
