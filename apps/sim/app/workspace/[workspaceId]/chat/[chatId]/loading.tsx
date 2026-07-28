import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

/**
 * Route-level fallback for an individual chat.
 *
 * Matches the page's own Suspense fallback, so opening a chat shows the same
 * frame it does today — extended over the page's server-side awaits, and
 * enabling prefetch of the segment.
 */
export default function ChatLoading() {
  return <HomeFallback />
}
