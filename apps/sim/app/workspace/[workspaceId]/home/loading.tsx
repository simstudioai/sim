import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

/**
 * Route-level fallback for the home surface.
 *
 * Renders the same `HomeFallback` the page already uses as its Suspense
 * fallback, so the visible result is unchanged — this only extends that frame
 * back over the page's server-side awaits, and lets Next prefetch the segment
 * (dynamic routes prefetch down to the nearest loading boundary).
 */
export default function HomeLoading() {
  return <HomeFallback />
}
