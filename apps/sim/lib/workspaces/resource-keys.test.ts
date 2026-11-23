import { describe, expect, it } from 'vitest'
import { nextFreeKey, resourceKeyBase } from '@/lib/workspaces/resource-keys'

const KEY_FORMAT = /^[a-z][a-z0-9_-]{0,63}$/

describe('resourceKeyBase', () => {
  it('slugs the name', () => {
    expect(resourceKeyBase('table', 'Leads (EU)!')).toBe('leads-eu')
  })

  it('keys a name with no slug characters by its kind', () => {
    expect(resourceKeyBase('knowledge-base', '***')).toBe('knowledge-base')
    expect(resourceKeyBase('credential', '')).toBe('credential')
  })

  it('prefixes the kind when the slug starts with a digit', () => {
    expect(resourceKeyBase('table', '2026 Leads')).toBe('table-2026-leads')
  })

  it('cuts an overlong name to the key length without a trailing hyphen', () => {
    const base = resourceKeyBase('table', `${'a'.repeat(63)} b`)
    expect(base).toBe('a'.repeat(63))
    expect(base).toMatch(KEY_FORMAT)
  })
})

describe('nextFreeKey', () => {
  it('returns the base when it is free', () => {
    expect(nextFreeKey('leads', new Set(['leads-2']))).toBe('leads')
  })

  it('skips every suffix already taken', () => {
    expect(nextFreeKey('leads', new Set(['leads', 'leads-2', 'leads-3']))).toBe('leads-4')
  })

  it('cuts a full-length base so the suffixed key still fits the stored format', () => {
    const base = 'b'.repeat(64)
    const taken = new Set([base])
    const key = nextFreeKey(base, taken)
    expect(key).toBe(`${'b'.repeat(62)}-2`)
    expect(key).toMatch(KEY_FORMAT)
    taken.add(key)
    expect(nextFreeKey(base, taken)).toBe(`${'b'.repeat(62)}-3`)
  })
})
