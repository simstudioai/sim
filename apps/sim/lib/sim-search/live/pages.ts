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

const MESSAGE_SEPARATOR = ' '

/** Joins status sentences once each, in first-seen order. */
export function joinMessages(messages: readonly (string | undefined)[]): string | undefined {
  return (
    [...new Set(messages.filter((message): message is string => Boolean(message)))].join(
      MESSAGE_SEPARATOR
    ) || undefined
  )
}

/**
 * Takes each given sentence out of a message {@link joinMessages} built, matching whole sentences
 * only. Returns the sentences found and what remains, undefined when nothing does.
 */
export function separateMessages<Key extends string>(
  message: string | undefined,
  sentences: Readonly<Record<Key, string>>
): { found: Key[]; rest: string | undefined } {
  let padded = `${MESSAGE_SEPARATOR}${message ?? ''}${MESSAGE_SEPARATOR}`
  const found: Key[] = []
  for (const key of Object.keys(sentences) as Key[]) {
    const bounded = `${MESSAGE_SEPARATOR}${sentences[key]}${MESSAGE_SEPARATOR}`
    if (!padded.includes(bounded)) continue
    padded = padded.replace(bounded, MESSAGE_SEPARATOR)
    found.push(key)
  }
  return {
    found,
    rest: padded.slice(MESSAGE_SEPARATOR.length, -MESSAGE_SEPARATOR.length) || undefined,
  }
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
      ...pages.filter((page) => page.partial || page.hasMore).map((page) => page.message),
      ...failures.map((error) =>
        error instanceof NativeSearchError ? error.message : 'One collection could not be searched.'
      ),
    ]),
  }
}
