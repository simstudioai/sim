import AppKit

@main struct NativeTests {
    static func expectError(_ code: String, _ operation: () throws -> Void) {
        do { try operation(); fatalError("Expected \(code)") }
        catch let error as ComputerError { precondition(error.code == code) }
        catch { fatalError("Unexpected \(error)") }
    }
    static func main() throws {
        let frame = CGRect(x: -1920, y: 120, width: 800, height: 600)
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
        cancellationRequested = 1
        expectError("cancelled") { try checkCancellation() }
        cancellationRequested = 0
        try checkCancellation()
        print("PASS: negative-display geometry, boundaries, nonfinite coordinates, shortcut modifiers, invalid keys, cancellation")
    }
}
