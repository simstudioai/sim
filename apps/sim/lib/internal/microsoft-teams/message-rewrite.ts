/** Each `<at>` mention in `content` with a non-blank name, which a send tries to resolve to a member. */
export function parseMentionNames(
  content: string
): Array<{ name: string; tag: string; id: number }> {
  const parsed: Array<{ name: string; tag: string; id: number }> = []
  const pattern = /<at>([^<]+)<\/at>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1].trim()
    if (name) parsed.push({ name, tag: match[0], id: parsed.length })
  }
  return parsed
}

/**
 * Whether sending `content` may rewrite it rather than post it as given: files attach, or a
 * mention resolves into Graph's mention markup when its name matches a member, which the request
 * alone cannot tell. Dependency-free, so a tool's dry-run placeholder can ask too.
 */
export function rewritesTeamsMessage(
  content: string,
  files: readonly unknown[] | null | undefined
): boolean {
  return Boolean(files?.length) || parseMentionNames(content).length > 0
}
