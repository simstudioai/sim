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
        try validateInputSteps([InputStep(action: "press_key", text: nil, key: "Cmd+A"), InputStep(action: "type_text", text: "hello 🌍", key: nil)])
        try validateInputSteps((1...5).flatMap { [InputStep(action: "type_text", text: String($0), key: nil), InputStep(action: "press_key", text: nil, key: "Enter")] })
        expectError("invalid_arguments") { try validateInputSteps([]) }
        expectError("invalid_arguments") { try validateInputSteps(Array(repeating: InputStep(action: "type_text", text: "x", key: nil), count: 33)) }
        expectError("invalid_arguments") { try validateInputSteps([InputStep(action: "type_text", text: String(repeating: "🌍", count: 16001), key: nil)]) }
        expectError("invalid_arguments") { try validateInputSteps([InputStep(action: "click", text: nil, key: nil)]) }
        expectError("unsupported_key") { try validateInputSteps([InputStep(action: "press_key", text: nil, key: "F99")]) }
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
        cancellationRequested = 1
        expectError("cancelled") { try checkCancellation() }
        cancellationRequested = 0
        try checkCancellation()
        print("PASS: negative-display geometry, boundaries, nonfinite coordinates, shortcut modifiers, invalid keys, cancellation, focused-editor priority, menu deferral, bounded traversal queue")
    }
}
