/**
 * Skills are markdown, not TypeScript: `skills/<key>.md` is a frontmatter block of `name` and
 * `description`, then the skill's content.
 *
 * ```md
 * ---
 * name: tone
 * description: "Answer in the support team's voice: short, warm, specific."
 * ---
 * Write like a person, not a policy.
 * ```
 *
 * A value is plain text on one line, or a JSON string (`"…"`) when it holds a line break,
 * surrounding spaces, quotes, `: ` or ` #`, ends in `:`, or starts with anything but a letter,
 * digit or `(`. Quote a value YAML would read as a boolean, number or date (`"yes"`, `"1e3"`) too,
 * so other markdown tools read it as text. The name is kebab-case; a workflow names the skill by
 * its key, `skill('tone')`. This module declares nothing.
 */
export {}
