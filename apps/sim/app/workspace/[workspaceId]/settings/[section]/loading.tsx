/**
 * Route-transition fallback for a workspace settings section.
 *
 * Without a loading boundary the App Router holds the outgoing section on screen until the
 * incoming page's access gate resolves, so a click reads as a dead click. This commits the
 * navigation immediately — the URL changes and the shell's heading updates with it — and
 * lets the gate resolve behind an empty body.
 *
 * The body is empty rather than a skeleton, matching every other route-level fallback in the
 * app: `ResourceChromeFallback` renders its real header and column headers over zero rows,
 * and the credit-usage fallback renders its real title and description over nothing. The
 * chrome is what signals arrival; placeholder rows would only add a shape that no section
 * actually has, and a layout shift when the real body replaces it.
 */
export default function WorkspaceSettingsSectionLoading() {
  return null
}
