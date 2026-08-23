/**
 * Route-transition fallback for the workspace settings sections.
 *
 * Its job is to exist. Without a loading boundary the App Router holds the outgoing section on
 * screen until the incoming page's access gate resolves, so a click reads as a dead click; with
 * one, the navigation commits immediately and the heading changes with it. It is also what
 * makes the sidebar's `router.prefetch` worth anything — with no loading boundary in the
 * subtree the scheduler skips the segment request entirely, and an `AUTO` prefetch caches the
 * shell only as far as the nearest boundary.
 *
 * It renders no body of its own because the shell that owns the header, heading and scroll
 * region renders above it and is already resolved by this point. That lands in the same place
 * as the two neighbouring settings fallbacks — credit-usage renders its title and description
 * over an empty body, `ResourceChromeFallback` renders a real header and column headers over
 * zero rows — without restating chrome this route already has.
 */
export default function WorkspaceSettingsSectionLoading() {
  return null
}
