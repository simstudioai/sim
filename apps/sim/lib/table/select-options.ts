import { generateShortId } from '@sim/utils/id'
import type { SelectOption } from '@/lib/table/types'

/**
 * Normalizes caller-supplied select options to `{ id, name }` pairs.
 *
 * Cells reference the option id, so an edit that re-sends an option by name
 * must reuse the id it already has — minting a fresh one would orphan every
 * cell holding it, silently clearing the column. A caller that already supplies
 * an id keeps it, which makes this a no-op for the fully-formed options the
 * HTTP contracts accept and a repair for the name-only options agents author.
 */
export function normalizeSelectOptionsInput(
  raw: unknown,
  existing: SelectOption[] = []
): SelectOption[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const idByName = new Map<string, string>()
  for (const option of existing) {
    const key = option.name.toLowerCase()
    if (!idByName.has(key)) idByName.set(key, option.id)
  }
  const resolveId = (name: string): string => idByName.get(name.toLowerCase()) ?? generateShortId()

  return raw.map((entry) => {
    if (typeof entry === 'string') return { id: resolveId(entry), name: entry }
    const e = (entry ?? {}) as { id?: unknown; name?: unknown }
    const name = typeof e.name === 'string' ? e.name : String(e.name ?? '')
    const id = typeof e.id === 'string' && e.id.length > 0 ? e.id : resolveId(name)
    return { id, name }
  })
}
