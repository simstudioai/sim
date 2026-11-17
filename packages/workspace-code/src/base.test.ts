import { describe, expect, it } from 'vitest'
import { parseWorkspaceBase } from './base'

const FINGERPRINT = `rf1:${'a'.repeat(64)}`

describe('parseWorkspaceBase', () => {
  it('keeps x- extensions at every level and refuses other unknown fields', () => {
    const parsed = parseWorkspaceBase({
      version: 1,
      workspaceId: 'ws',
      'x-note': 'kept',
      resources: {
        'table:leads': {
          id: 'tbl',
          fingerprint: FINGERPRINT,
          'x-owner': 'ops',
          columns: { email: { id: 'col_1', 'x-legacy': true, options: { a: 'opt_1' } } },
        },
      },
    })
    expect(parsed.base).toEqual({
      version: 1,
      workspaceId: 'ws',
      'x-note': 'kept',
      resources: {
        'table:leads': {
          id: 'tbl',
          fingerprint: FINGERPRINT,
          'x-owner': 'ops',
          columns: { email: { id: 'col_1', 'x-legacy': true, options: { a: 'opt_1' } } },
        },
      },
    })
    const typo = parseWorkspaceBase({ version: 1, workspaceId: 'ws', resources: {}, resorces: {} })
    expect(typo.diagnostics).toMatchObject([{ code: 'E_BASE_UNKNOWN_FIELD', path: '/resorces' }])
  })

  it('refuses a bad address, fingerprint or version with a pointer to it', () => {
    const parsed = parseWorkspaceBase(
      JSON.stringify({
        version: 1,
        workspaceId: 'ws',
        resources: {
          'gadget:x': { id: 'a' },
          'table:leads': { id: 'tbl', fingerprint: 'sf1:abc' },
        },
      })
    )
    expect(parsed.diagnostics?.map((finding) => [finding.code, finding.path])).toEqual([
      ['E_BASE_SHAPE', '/resources/gadget:x'],
      ['E_BASE_SHAPE', '/resources/table:leads/fingerprint'],
    ])
    expect(parseWorkspaceBase({ version: 2 }).diagnostics?.[0]?.code).toBe('E_BASE_VERSION')
    expect(parseWorkspaceBase('{').diagnostics?.[0]?.code).toBe('E_BASE_JSON')
  })
})
