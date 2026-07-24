/**
 * Humanizes a block's technical name for the card title: camelCase,
 * snake_case, and kebab-case become spaced Title Case ("updatePosted" →
 * "Update Posted", "did_it_post" → "Did It Post"). Existing capitals and
 * acronym runs are preserved ("APICall" → "API Call"); names that are
 * already natural language pass through unchanged.
 */
export function humanizeBlockName(name: string): string {
  const spaced = name
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
