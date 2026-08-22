import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

/**
 * Route-level loading boundary for a chat.
 *
 * Its real job is prefetching, not painting. With `cacheComponents` off, a
 * default `<Link>` prefetch degrades to Next's LoadingBoundary strategy, which
 * prefetches a dynamic route only as far as its nearest `loading` segment — so
 * a route without one is prefetched as nothing, and clicking a chat leaves the
 * previous chat frozen on screen until the server responds. This file is what
 * makes that click commit immediately.
 *
 * Renders the same surface `HomeFallback` gives the Suspense boundary inside
 * the page, so the loading frame and the mounted frame share a background and
 * the transition reads as one step rather than two.
 */
export default function ChatLoading() {
  return <HomeFallback />
}
