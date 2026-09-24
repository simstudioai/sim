/** Answer tags the Chat UI renders as interactive cards; text-only surfaces drop them. */
const INTERACTIVE_TAGS =
  /<(options|question|thinking|usage_upgrade|credential|workspace_resource)>[\s\S]*?(?:<\/\1>|$)/g

/** Removes interactive Chat UI tags, including one still open at the end of a partial stream. */
export function stripInteractiveTags(text: string): string {
  return text.replace(INTERACTIVE_TAGS, '')
}
