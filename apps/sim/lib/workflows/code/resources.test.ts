import { describe, expect, it } from 'vitest'
import { assignResourceKeys } from '@/lib/workflows/code/resources'

const at = (ms: number) => new Date(ms)

describe('assignResourceKeys', () => {
  it('gives the earliest-created resource the bare slug whatever order rows arrive in', () => {
    const rows = [
      { id: 'b', name: 'Leads', createdAt: at(2) },
      { id: 'a', name: 'leads!', createdAt: at(1) },
      { id: 'c', name: 'LEADS', createdAt: at(3) },
    ]

    const forward = assignResourceKeys('table', rows)
    const reversed = assignResourceKeys('table', [...rows].reverse())

    expect(Object.fromEntries(forward.byId)).toEqual({ a: 'leads', b: 'leads-2', c: 'leads-3' })
    expect(Object.fromEntries(reversed.byId)).toEqual(Object.fromEntries(forward.byId))
  })

  it('breaks a creation-time tie by id', () => {
    const keys = assignResourceKeys('table', [
      { id: 'z', name: 'Docs', createdAt: at(1) },
      { id: 'y', name: 'Docs', createdAt: at(1) },
    ])

    expect(keys.byId.get('y')).toBe('docs')
    expect(keys.byId.get('z')).toBe('docs-2')
  })

  it('skips a suffix another resource already holds as its own slug', () => {
    const keys = assignResourceKeys('knowledge-base', [
      { id: 'a', name: 'Docs', createdAt: at(1) },
      { id: 'b', name: 'docs 2', createdAt: at(2) },
      { id: 'c', name: 'Docs', createdAt: at(3) },
    ])

    expect(keys.byId.get('b')).toBe('docs-2')
    expect(keys.byId.get('c')).toBe('docs-3')
    expect(new Set(keys.byId.values()).size).toBe(3)
  })

  it('keys a name with no slug characters by its kind', () => {
    const keys = assignResourceKeys('credential', [
      { id: 'a', name: '***', createdAt: at(1) },
      { id: 'b', name: '', createdAt: at(2) },
    ])

    expect(keys.byId.get('a')).toBe('credential')
    expect(keys.byId.get('b')).toBe('credential-2')
  })

  it('maps every key back to the id it was assigned', () => {
    const keys = assignResourceKeys('workflow', [
      { id: 'a', name: 'Enrich', createdAt: at(1) },
      { id: 'b', name: 'Enrich', createdAt: at(2) },
    ])

    for (const [id, key] of keys.byId) expect(keys.byKey.get(key)).toBe(id)
  })
})
