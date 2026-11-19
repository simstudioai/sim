import AppKit

@main struct NativeTests {
    static func expectError(_ code: String, _ operation: () throws -> Void) {
        do { try operation(); fatalError("Expected \(code)") }
        catch let error as ComputerError { precondition(error.code == code) }
        catch { fatalError("Unexpected \(error)") }
    }
    @MainActor static func main() async throws {
        let frame = CGRect(x: -1920, y: 120, width: 800, height: 600)
        try requireObservedFrame(frame, current: frame)
        expectError("stale_window") { try requireObservedFrame(frame, current: frame.offsetBy(dx: 1, dy: 0)) }
        expectError("stale_window") { try requireObservedFrame(frame, current: CGRect(origin: frame.origin, size: CGSize(width: 801, height: 600))) }
        expectError("stale_window") { try requireObservedFrame(frame, current: CGRect(x: 0, y: 120, width: 800, height: 600)) }
        let interior = try mapPoint(frame: frame, x: 20, y: 30)
        precondition(interior == CGPoint(x: -1900, y: 150))
        let origin = try mapPoint(frame: frame, x: 0, y: 0)
        precondition(origin == frame.origin)
        for point in [(Double.nan, 0.0), (Double.infinity, 0.0), (-1.0, 1.0), (800.0, 0.0), (0.0, 600.0)] {
            expectError("invalid_coordinates") { _ = try mapPoint(frame: frame, x: point.0, y: point.1) }
        }
        let (code, flags) = try parseKey("Cmd+Shift+A")
        precondition(code == 0 && flags == [.maskCommand, .maskShift])
        let enter = try parseKey("Enter"); precondition(enter.0 == 36)
        let optionLeft = try parseKey("Option+Left"); precondition(optionLeft.1 == .maskAlternate)
        expectError("unsupported_key") { _ = try parseKey("F99") }
        expectError("invalid_arguments") { _ = try parseKey("Hyper+A") }
        expectError("invalid_arguments") { _ = try required(Optional<String>.none, "example") }
        var finitePoint = CGPoint(x: 10, y: 20), infinitePoint = CGPoint(x: CGFloat.infinity, y: -CGFloat.infinity)
        var size = CGSize(width: 30, height: 40)
        let sizeValue = AXValueCreate(.cgSize, &size)
        precondition(axRect(position: AXValueCreate(.cgPoint, &finitePoint), size: sizeValue) == CGRect(x: 10, y: 20, width: 30, height: 40))
        precondition(axRect(position: AXValueCreate(.cgPoint, &infinitePoint), size: sizeValue) == nil)
        expectError("reply_unencodable") { _ = try encodeReply(["id": "nonfinite", "result": ["x": Double.infinity]]) }
        for bundle in ["com.apple.systempreferences", "com.apple.Terminal", "COM.GOOGLECODE.ITERM2", "net.kovidgoyal.kitty", "com.1password.1password", "com.apple.Passwords", "com.bitwarden.desktop", "ai.sim.desktop", "com.simstudio.computer-use", "com.apple.ScriptEditor2", "com.apple.Automator", "com.apple.shortcuts"] {
            precondition(isProtectedApp(bundle), bundle)
        }
        for bundle in ["com.apple.TextEdit", "com.apple.finder", "com.apple.Safari"] { precondition(!isProtectedApp(bundle), bundle) }
        let dateOnly = try dueComponents("2027-05-04")
        precondition(dateOnly.year == 2027 && dateOnly.month == 5 && dateOnly.day == 4 && dateOnly.hour == nil)
        let timed = try dueComponents("2027-05-04T09:30:45Z")
        precondition(timed.hour != nil && timed.minute != nil && timed.second == 45)
        let localDue = try dueComponents("2027-05-04T09:30")
        precondition(localDue.hour == 9 && localDue.minute == 30)
        for due in ["2027-02-30", "2027-05-04T25:30:00", "May 4", "2027-5-4", "2027-02-30T09:00:00Z", "2027-02-29T09:00:00.5+01:00", "2027-05-04T24:00:00Z", "2027-05-04T09:00:00+25:00", "2027-05-04T09:00:00+05:99", "2027-05-04T09:00:00+14:59", "2027-05-04T09:00:00-14:30", "2027-0٥-04", "2027-05-04T1٠:00Z"] {
            expectError("invalid_arguments") { _ = try dueComponents(due) }
        }
        precondition(isoDateTime("2028-02-29T09:00Z") == Date(timeIntervalSince1970: 1_835_427_600))
        precondition(isoDateTime("2027-05-04T09:00:00+05:30") == Date(timeIntervalSince1970: 1_809_401_400))
        precondition(isoDateTime("2027-05-04T09:00:00+14:00") == Date(timeIntervalSince1970: 1_809_370_800))
        expectError("unknown_command") { _ = try runAppCommand(AppCommand(name: "run_script")) }
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_reminder", title: "  ")) }
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_reminder", title: "Pay rent", priority: 3)) }
        var local = Calendar(identifier: .gregorian); local.timeZone = .current
        let floating = try eventDate("2027-06-09T07:15:00", "Start", allDay: false)
        precondition(local.dateComponents([.hour, .minute], from: floating) == DateComponents(hour: 7, minute: 15))
        expectError("invalid_arguments") { _ = try eventDate("2027-06-09 07:15", "Start", allDay: false) }
        let fractional = try eventDate("2027-06-09T06:15:00.000Z", "Start", allDay: false)
        precondition(fractional == Date(timeIntervalSince1970: 1_812_521_700))
        let localFraction = try eventDate("2027-06-09T07:15:00.250", "Start", allDay: false)
        precondition(local.dateComponents([.hour, .minute], from: localFraction) == DateComponents(hour: 7, minute: 15))
        expectError("invalid_arguments") { _ = try eventDate("2027-06-09T07:15:00+01:00", "Start", allDay: true) }
        let zoned = try eventDate("2027-06-09T07:15:00+01:00", "Start", allDay: false)
        precondition(zoned == Date(timeIntervalSince1970: 1_812_521_700))
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_event", title: "Flight", start: "2027-06-09T08:10:00Z", end: "2027-06-09T07:15:00Z")) }
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_event", title: "Trip", start: "2027-06-01T00:00:00Z", end: "2027-08-01T00:00:00Z")) }
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_contact", jobTitle: "Engineer")) }
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_contact", givenName: "Ana", emails: ["not-an-email"])) }
        expectError("invalid_arguments") { _ = try runAppCommand(AppCommand(name: "create_contact_group", title: " ")) }
        var queue = AXTraversalQueue<String>(limit: 1000)
        queue.append(AXTraversalEntry(element: "menu", parent: nil, depth: 0, menu: true, priority: false))
        queue.append(AXTraversalEntry(element: "content", parent: nil, depth: 0, menu: false, priority: false))
        queue.append(AXTraversalEntry(element: "focused-editor", parent: "content", depth: 35, menu: false, priority: true))
        precondition(queue.next()?.element == "focused-editor")
        precondition(queue.next()?.element == "content")
        precondition(queue.next()?.element == "menu")
        precondition(queue.next() == nil)
        var bounded = AXTraversalQueue<Int>(limit: 3)
        for index in 0..<10 { bounded.append(AXTraversalEntry(element: index, parent: nil, depth: 0, menu: false, priority: false)) }
        precondition(bounded.truncated)
        precondition(bounded.next()?.element == 0)
        precondition(bounded.next()?.element == 1)
        precondition(bounded.next()?.element == 2)
        precondition(bounded.next() == nil)
        try validateInputSteps([Parameters(action: "press_key", key: "Cmd+A"), Parameters(action: "type_text", text: "hello 🌍")])
        try validateInputSteps((1...5).flatMap { [Parameters(action: "type_text", text: String($0)), Parameters(action: "press_key", key: "Enter")] })
        expectError("invalid_arguments") { try validateInputSteps([]) }
        expectError("invalid_arguments") { try validateInputSteps(Array(repeating: Parameters(action: "type_text", text: "x"), count: 33)) }
        expectError("invalid_arguments") { try validateInputSteps([Parameters(action: "type_text", text: String(repeating: "🌍", count: 16001))]) }
        expectError("invalid_arguments") { try validateInputSteps([Parameters(action: "click")]) }
        expectError("unsupported_key") { try validateInputSteps([Parameters(action: "press_key", key: "F99")]) }
        try validateBatchSteps([Parameters(action: "set_value", elementId: "e1", value: "Name"), Parameters(action: "click", elementId: "e2")])
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "click", elementId: "e1")]) }
        expectError("invalid_arguments") { try validateBatchSteps(Array(repeating: Parameters(action: "press_key", key: "Tab"), count: 9)) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "drag"), Parameters(action: "press_key", key: "Enter")]) }
        expectError("unsupported_key") { try validateBatchSteps([Parameters(action: "click", elementId: "e1"), Parameters(action: "press_key", key: "F99")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "click", elementId: "e1"), Parameters(action: "click")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "click", elementId: "e1"), Parameters(action: "scroll", elementId: "e2")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "click", elementId: "e1"), Parameters(action: "type_text", elementId: "e2")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "set_value", value: "x"), Parameters(action: "click", elementId: "e1")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "click", elementId: "e1", clickCount: 4), Parameters(action: "press_key", key: "Enter")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "click", bundleId: "com.example", elementId: "e1"), Parameters(action: "press_key", key: "Enter")]) }
        expectError("invalid_arguments") { try validateBatchSteps([Parameters(action: "set_value", elementId: "e1", value: String(repeating: "🌍", count: 8001)), Parameters(action: "type_text", elementId: "e2", text: String(repeating: "🌍", count: 8000))]) }
        let tabFocus = try keyMayChangeFocus("Tab"); precondition(tabFocus)
        let submitFocus = try keyMayChangeFocus("Enter"); precondition(!submitFocus)
        let searchFocus = try keyMayChangeFocus("Cmd+K"); precondition(searchFocus)
        let selectFocus = try keyMayChangeFocus("Cmd+A"); precondition(!selectFocus)
        do {
            try await coordinateAction { _ in throw ComputerError("foreground_required", "preflight") }
            fatalError("Expected pre-dispatch rejection")
        } catch let error as ComputerError {
            precondition(error.code == "foreground_required" && error.dispatchState == "not_started")
        }
        for code in ["foreground_required", "window_occluded", "cancelled"] {
            do {
                try await coordinateAction { dispatch in
                    dispatch.willDispatch()
                    throw ComputerError(code, "after mouse down", dispatchState: "not_started")
                }
                fatalError("Expected partial dispatch rejection")
            } catch let error as ComputerError {
                precondition(error.code == code && error.dispatchState == nil)
            }
        }
        let nodes: [[String: Any]] = (0..<2000).map { index in
            var node: [String: Any] = ["elementId": "n\(index)", "role": "AXTextField", "actions": [], "label": String(repeating: "🌍\\\"", count: 1024), "value": String(repeating: "界", count: 2048)]
            if index > 0 { node["parentId"] = "n\(index - 1)" }
            return node
        }
        let state: [String: Any] = ["kind": "state", "bundleId": "com.example.Fixture", "snapshotId": "snapshot", "windowId": "w1", "windows": [["windowId": "w1", "title": "Fixture", "x": 0, "y": 0, "width": 400, "height": 300]], "nodes": nodes, "truncated": false, "screenshot": ["base64": String(repeating: "a", count: 11_000_000), "mimeType": "image/png", "width": 1600, "height": 1600]]
        for nested in [false, true] {
            let result: [String: Any] = nested ? ["kind": "action", "bundleId": "com.example.Fixture", "action": "input_sequence", "dispatched": true, "verified": false, "sequence": ["completedSteps": 1, "totalSteps": 2, "error": "Focus changed"], "observation": state] : state
            let encoded = try encodeReply(["id": "bounded-reply", "result": result])
            precondition(encoded.count <= 16 * 1024 * 1024, "Native reply exceeds receiver limit")
            let decoded = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
            precondition(decoded["id"] as? String == "bounded-reply")
            let returned = decoded["result"] as! [String: Any]
            let observed = nested ? returned["observation"] as! [String: Any] : returned
            precondition(observed["truncated"] as? Bool == true)
            precondition(observed["screenshot"] == nil && observed["screenshotError"] is String)
            let kept = observed["nodes"] as! [[String: Any]]
            precondition(!kept.isEmpty && kept.count < nodes.count)
            let ids = Set(kept.compactMap { $0["elementId"] as? String })
            precondition(kept.allSatisfy { node in (node["parentId"] as? String).map { ids.contains($0) } ?? true })
            if nested {
                precondition(returned["dispatched"] as? Bool == true && returned["verified"] as? Bool == false)
                let sequence = returned["sequence"] as! [String: Any]
                precondition(sequence["completedSteps"] as? Int == 1 && sequence["error"] as? String == "Focus changed")
            }
        }
        cancellationRequested = 1
        expectError("cancelled") { try checkCancellation() }
        cancellationRequested = 0
        try checkCancellation()
        print("PASS: negative-display geometry, boundaries, nonfinite coordinates, shortcut modifiers, invalid keys, cancellation, focused-editor priority, menu deferral, bounded traversal queue")
    }
}
