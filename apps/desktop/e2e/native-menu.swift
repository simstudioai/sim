import AppKit
import ApplicationServices
import Foundation

func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}
func children(_ element: AXUIElement, _ key: String = kAXChildrenAttribute) -> [AXUIElement] {
  return attribute(element, key) as? [AXUIElement] ?? []
}
func title(_ element: AXUIElement) -> String {
  return attribute(element, kAXTitleAttribute) as? String ?? ""
}
func point(_ element: AXUIElement) -> CGPoint? {
  guard let raw = attribute(element, kAXPositionAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
  var value = CGPoint.zero
  return AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgPoint, &value) ? value : nil
}
func size(_ element: AXUIElement) -> CGSize? {
  guard let raw = attribute(element, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
  var value = CGSize.zero
  return AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgSize, &value) ? value : nil
}
func describe(_ element: AXUIElement) -> [String: Any] {
  var result: [String: Any] = ["title": title(element), "role": attribute(element, kAXRoleAttribute) as? String ?? ""]
  if let value = attribute(element, kAXEnabledAttribute) as? Bool { result["enabled"] = value }
  if let value = attribute(element, kAXFocusedAttribute) as? Bool { result["focused"] = value }
  if let value = attribute(element, kAXSelectedAttribute) as? Bool { result["selected"] = value }
  if let value = attribute(element, kAXExpandedAttribute) as? Bool { result["expanded"] = value }
  if let value = point(element) { result["position"] = ["x": value.x, "y": value.y] }
  if let value = size(element) { result["size"] = ["width": value.width, "height": value.height] }
  return result
}
func find(_ element: AXUIElement, _ target: String, _ depth: Int) -> AXUIElement? {
  if title(element) == target { return element }
  if depth > 0 {
    for child in children(element) {
      if let result = find(child, target, depth - 1) { return result }
    }
  }
  return nil
}
let args = CommandLine.arguments
var output: [String: Any] = ["at": Date().timeIntervalSince1970 * 1000, "axTrusted": AXIsProcessTrusted(), "canPostEvents": CGPreflightPostEventAccess()]
var success = false
if args.count == 3, let pid = Int32(args[1]) {
  let target = AXUIElementCreateApplication(pid)
  output["pid"] = pid
  output["command"] = args[2]
  output["windows"] = children(target, kAXWindowsAttribute).map { window -> [String: Any] in
    var item = describe(window)
    item["children"] = children(window).map(describe)
    return item
  }
  if let pointer = CGEvent(source: nil)?.location {
    output["pointer"] = ["x": pointer.x, "y": pointer.y]
    var hit: AXUIElement?
    let status = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(pointer.x), Float(pointer.y), &hit)
    output["hitStatus"] = status.rawValue
    if let hit { output["pointerElement"] = describe(hit) }
  }
  if let rawMenu = attribute(target, kAXMenuBarAttribute), CFGetTypeID(rawMenu) == AXUIElementGetTypeID() {
    let menuBar = unsafeBitCast(rawMenu, to: AXUIElement.self)
    output["menuBar"] = children(menuBar).map(describe)
    if let file = children(menuBar).first(where: { title($0) == "File" }) {
      if args[2] == "escape" {
        for down in [true, false] {
          CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: down)?.post(tap: .cghidEventTap)
        }
        success = true
      } else if args[2] == "open" {
        let status = AXUIElementPerformAction(file, kAXPressAction as CFString)
        output["actionStatus"] = status.rawValue
        success = status == .success
      } else {
        let item = find(file, "Folder Access…", 4)
        output["ready"] = item != nil
        if let item {
          output["item"] = describe(item)
          if args[2] == "press", let position = point(item), let dimensions = size(item), dimensions.width > 0, dimensions.height > 0 {
            let location = CGPoint(x: position.x + dimensions.width / 2, y: position.y + dimensions.height / 2)
            output["clickPoint"] = ["x": location.x, "y": location.y]
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left)?.post(tap: .cghidEventTap)
            let status = AXUIElementPerformAction(item, kAXPressAction as CFString)
            output["actionStatus"] = status.rawValue
            success = status == .success
          } else {
            success = args[2] == "inspect"
          }
        } else {
          success = args[2] == "inspect"
        }
      }
    } else { output["error"] = "File menu not found" }
  } else { output["error"] = "Application menu bar unavailable" }
} else { output["error"] = "Expected PID and open, inspect, press, or escape" }
output["ok"] = success
let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
exit(success ? 0 : 1)
