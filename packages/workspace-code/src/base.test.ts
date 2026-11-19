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

  it('escapes blob and column names in the pointer to a bad entry', () => {
    const parsed = parseWorkspaceBase({
      version: 1,
      workspaceId: 'ws',
      resources: {
        'file:docs/a.txt': { id: 'f', blobs: { 'files/docs/a~b.txt': { id: 'f' } } },
        'table:leads': { id: 'tbl', columns: { 'a/b': {} } },
      },
    })
    expect(parsed.diagnostics?.map((finding) => finding.path)).toEqual([
      '/resources/file:docs~1a.txt/blobs/files~1docs~1a~0b.txt',
      '/resources/table:leads/columns/a~1b',
    ])
  })

  it('keeps column, option and blob names that are Object.prototype keys as plain entries', () => {
    const parsed = parseWorkspaceBase(`{
      "version": 1,
      "workspaceId": "ws",
      "resources": {
        "table:leads": {
          "id": "tbl",
          "columns": {
            "__proto__": { "id": "col_evil", "options": { "__proto__": "opt_evil" } },
            "email": { "id": "col_1" }
          },
          "blobs": { "__proto__": { "id": "b", "rev": 1, "sha256": "${'a'.repeat(64)}" } }
        }
      }
    }`)
    const resource = parsed.base?.resources['table:leads']
    const columns = resource?.columns ?? {}

    expect(Object.keys(columns).sort()).toEqual(['__proto__', 'email'])
    expect('id' in columns).toBe(false)
    expect('constructor' in columns).toBe(false)
    expect(
      Object.keys(Object.getOwnPropertyDescriptor(columns, '__proto__')?.value.options)
    ).toEqual(['__proto__'])
    expect(Object.keys(resource?.blobs ?? {})).toEqual(['__proto__'])
  })
})
