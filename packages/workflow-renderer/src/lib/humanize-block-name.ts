/**
 * Humanizes a block's technical name for the card title: camelCase,
 * snake_case, and kebab-case become spaced Title Case ("updatePosted" →
 * "Update Posted", "did_it_post" → "Did It Post"). Existing capitals and
 * acronym runs are preserved ("APICall" → "API Call").
 *
 * A name containing whitespace is already prose and is returned untouched.
 * Only a single unbroken token can be a technical identifier, so this is what
 * keeps a user-authored name intact — without the guard, "check on-call rota"
 * became "Check On Call Rota", losing the hyphen and force-capitalizing every
 * word, and the card would no longer show the name that the editor panel,
 * search, and `<Block.output>` references all use.
 */
export function humanizeBlockName(name: string): string {
  const trimmed = name.trim()
  if (/\s/.test(trimmed)) return trimmed

  const spaced = trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return name
  return spaced
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}
