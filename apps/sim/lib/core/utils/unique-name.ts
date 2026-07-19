/**
 * First name from `formatCandidate(0)`, `formatCandidate(1)`, … that is not in
 * `existingNames`. By convention `formatCandidate(0)` is the base name and
 * higher attempts produce suffixed variants (e.g. `` (n) => n === 0 ? 'New
 * folder' : `New folder (${n})` ``). Terminates within `existingNames.length
 * + 1` iterations since each attempt yields a distinct candidate.
 *
 * @param existingNames - Names already taken.
 * @param formatCandidate - Builds the candidate for a given attempt number.
 * @param options - Set `caseInsensitive` to compare names case-insensitively.
 */
export function generateUniqueName(
  existingNames: Iterable<string>,
  formatCandidate: (attempt: number) => string,
  options?: { caseInsensitive?: boolean }
): string {
  const caseInsensitive = options?.caseInsensitive ?? false
  const normalize = (name: string) => (caseInsensitive ? name.toLowerCase() : name)

  const taken = new Set<string>()
  for (const name of existingNames) {
    taken.add(normalize(name))
  }

  for (let attempt = 0; ; attempt++) {
    const candidate = formatCandidate(attempt)
    if (!taken.has(normalize(candidate))) return candidate
  }
}
