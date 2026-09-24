import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { NativePage } from '@/lib/sim-search/live/types'

/**
 * Merges ranked lists by position: every list's first item, then every second item, and so on.
 * A populous list therefore cannot consume all of the previews ahead of the others.
 */
export function interleaveByRank<T>(lists: readonly (readonly T[])[]): T[] {
  const merged: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) if (rank < list.length) merged.push(list[rank]!)
  }
  return merged
}

/** Joins status sentences once each, in first-seen order. */
export function joinMessages(messages: readonly (string | undefined)[]): string | undefined {
  return (
    [...new Set(messages.filter((message): message is string => Boolean(message)))].join(' ') ||
    undefined
  )
}

/** Independent collections retain their successful evidence if another collection fails. */
export async function collectNativePages(
  requests: Promise<NativePage>[],
  guidance: string
): Promise<NativePage> {
  const results = await Promise.allSettled(requests)
  const pages = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (!pages.length && failures.length) throw failures[0]
  return {
    documents: interleaveByRank(pages.map((page) => page.documents)),
    partial: failures.length > 0 || pages.some((page) => page.partial),
    hasMore: pages.some((page) => page.hasMore || page.nextCursor),
    message: joinMessages([
      guidance,
      ...pages.filter((page) => page.partial).map((page) => page.message),
      ...failures.map((error) =>
        error instanceof NativeSearchError ? error.message : 'One collection could not be searched.'
      ),
    ]),
  }
}
