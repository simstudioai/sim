import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { NativePage } from '@/lib/sim-search/live/types'

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
  const documents = []
  // Interleave ranks so a populous collection cannot consume all cross-collection previews.
  for (let rank = 0; rank < Math.max(0, ...pages.map((page) => page.documents.length)); rank++) {
    for (const page of pages) if (page.documents[rank]) documents.push(page.documents[rank])
  }
  return {
    documents,
    partial: failures.length > 0 || pages.some((page) => page.partial || page.nextCursor),
    message: [
      guidance,
      ...failures.map((error) =>
        error instanceof NativeSearchError ? error.message : 'One collection could not be searched.'
      ),
    ].join(' '),
  }
}
