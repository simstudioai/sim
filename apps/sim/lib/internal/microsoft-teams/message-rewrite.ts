/** An `<at>` mention, which a send resolves into Graph's mention markup. */
const MENTION_PATTERN = /<at>[^<]+<\/at>/i

/**
 * Whether sending `content` rewrites it (attaching files or resolving mentions) rather than
 * posting it as given. Dependency-free, so a tool's dry-run placeholder can ask too.
 */
export function rewritesTeamsMessage(
  content: string,
  files: readonly unknown[] | null | undefined
): boolean {
  return Boolean(files?.length) || MENTION_PATTERN.test(content)
}
