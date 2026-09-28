import { truncateAtCodePoint } from '@sim/utils/string'
import { NativeSearchError } from '@/lib/sim-search/live/http'

/** Leaves room for file content and authorization within one live read's request budget. */
const DISCUSSION_MAX_PAGES = 3
const DISCUSSION_MAX_CHARACTERS = 120_000

interface DiscussionPage {
  entries: Iterable<string>
  nextCursor?: string
}

/**
 * Collects a bounded discussion without representing provider failures or omitted pages as an
 * empty, complete history. The caller puts the warning before the document's first read window.
 * Cancellation is judged by the caller's signal after the read, not by the error's shape.
 */
export async function readDiscussionSection(
  label: string,
  readPage: (cursor?: string) => Promise<DiscussionPage>
): Promise<{ content: string; warning?: string }> {
  const entries: string[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  let characters = 0
  let omitted: string | undefined
  for (let page = 0; page < DISCUSSION_MAX_PAGES; page++) {
    try {
      const result = await readPage(cursor)
      for (const entry of result.entries) {
        if (!entry) continue
        const remaining = Math.max(0, DISCUSSION_MAX_CHARACTERS - characters - 2)
        entries.push(truncateAtCodePoint(entry, remaining, ''))
        characters += Math.min(entry.length, remaining) + 2
        if (entry.length > remaining) {
          omitted = 'exceeded the discussion text limit'
          break
        }
      }
      if (omitted || !result.nextCursor) break
      if (cursors.has(result.nextCursor)) {
        omitted = 'returned a repeated page cursor'
        break
      }
      cursor = result.nextCursor
      cursors.add(cursor)
      if (page === DISCUSSION_MAX_PAGES - 1)
        omitted = 'reached the page limit; more entries may exist'
    } catch (error) {
      omitted = error instanceof NativeSearchError ? error.message : 'could not be fully retrieved'
      break
    }
  }
  return {
    content: `## ${label}\n\n${entries.join('\n\n') || (omitted ? 'No entries retrieved.' : 'No entries returned.')}`,
    ...(omitted
      ? {
          warning: `Coverage incomplete: ${label} ${omitted}. Open the source for the remaining discussion.`,
        }
      : {}),
  }
}
