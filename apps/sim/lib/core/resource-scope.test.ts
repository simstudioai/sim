/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  resourceScopeColumns,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'

describe('resource ownership', () => {
  it.each([{}, { workspaceId: 'workspace', organizationId: 'org' }])(
    'rejects missing or ambiguous ownership',
    (owner) => {
      expect(() => resourceScopeFromOwner(owner)).toThrow('exactly one')
    }
  )
  it('keeps organization and workspace IDs in different namespaces', () => {
    expect(
      sameResourceScope(
        { kind: 'organization', organizationId: 'same' },
        { kind: 'workspace', workspaceId: 'same' }
      )
    ).toBe(false)
  })
  it('clears the other owner when writing scope columns', () => {
    expect(resourceScopeColumns({ kind: 'organization', organizationId: 'org' })).toEqual({
      organizationId: 'org',
      workspaceId: null,
    })
  })
})
