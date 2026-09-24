/** Answer tags the Chat UI renders as interactive cards; text-only surfaces drop them. */
const CLOSED_TAGS =
  /<(options|question|thinking|usage_upgrade|credential|workspace_resource)>[\s\S]*?<\/\1>/g
/** An interactive tag still open at the end of a partial stream. */
const TRAILING_OPEN_TAG =
  /<(options|question|thinking|usage_upgrade|credential|workspace_resource)>(?![\s\S]*<\/\1>)[\s\S]*$/

/**
 * Removes interactive Chat UI tags. A streaming answer also withholds a tag that has not closed
 * yet; a complete answer keeps text after an unclosed opener, which is prose rather than a card.
 */
export function stripInteractiveTags(text: string, options: { complete: boolean }): string {
  const closed = text.replace(CLOSED_TAGS, '')
  return options.complete ? closed : closed.replace(TRAILING_OPEN_TAG, '')
}
