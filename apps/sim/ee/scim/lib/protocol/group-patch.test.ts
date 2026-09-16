/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { scimPatchBodySchema } from '@/lib/api/contracts/scim'
import { SCIM_PATCH_OP_SCHEMA } from '@/ee/scim/lib/protocol/constants'
import type { ScimError } from '@/ee/scim/lib/protocol/errors'
import { parseGroupPatch } from '@/ee/scim/lib/protocol/group-patch'

function parseOperations(operations: unknown[]) {
  return scimPatchBodySchema.parse({ schemas: [SCIM_PATCH_OP_SCHEMA], Operations: operations })
    .Operations
}

describe('parseGroupPatch', () => {
  it('lets the last operation naming a member win', () => {
    expect(
      parseGroupPatch([
        { op: 'add', path: 'members', value: [{ value: 'u1' }] },
        { op: 'remove', path: 'members[value eq "u1"]' },
      ])
    ).toEqual({ kind: 'incremental', add: [], remove: ['u1'] })
    expect(
      parseGroupPatch([
        { op: 'remove', path: 'members[value eq "u1"]' },
        { op: 'add', path: 'members', value: [{ value: 'u1' }] },
      ])
    ).toEqual({ kind: 'incremental', add: ['u1'], remove: [] })
  })

  it('treats a path-less add of members as a delta, not a replacement', () => {
    expect(parseGroupPatch([{ op: 'add', value: { members: [{ value: 'u9' }] } }])).toEqual({
      kind: 'full',
      addMembers: ['u9'],
      removeMembers: [],
    })
  })

  it('refuses an add to members with no value', () => {
    expect(() => parseGroupPatch([{ op: 'add', path: 'members' }])).toThrow('requires a value')
  })

  it('refuses a non-string externalId instead of clearing it', () => {
    expect(() => parseGroupPatch([{ op: 'replace', path: 'externalId', value: 42 }])).toThrow(
      'externalId must be a string'
    )
  })

  it('reads Okta’s filtered member removal', () => {
    const patch = parseGroupPatch(
      parseOperations([{ op: 'remove', path: 'members[value eq "u1"]' }])
    )
    expect(patch).toEqual({ kind: 'incremental', add: [], remove: ['u1'] })
  })

  it('reads Okta’s member addition', () => {
    const patch = parseGroupPatch(
      parseOperations([{ op: 'add', path: 'members', value: [{ value: 'u1', display: 'Ada' }] }])
    )
    expect(patch).toEqual({ kind: 'incremental', add: ['u1'], remove: [] })
  })

  it('reads Entra’s legacy removal, which identifies the member by value alone', () => {
    const patch = parseGroupPatch(
      parseOperations([{ op: 'Remove', path: 'members', value: [{ value: 'u1' }] }])
    )
    expect(patch).toEqual({ kind: 'incremental', add: [], remove: ['u1'] })
  })

  it('reads Entra’s add form with a null $ref alongside the value', () => {
    const patch = parseGroupPatch(
      parseOperations([{ op: 'Add', path: 'members', value: [{ $ref: null, value: 'u2' }] }])
    )
    expect(patch).toEqual({ kind: 'incremental', add: ['u2'], remove: [] })
  })

  it('treats a wholesale member replacement as a full patch', () => {
    const patch = parseGroupPatch(
      parseOperations([{ op: 'replace', path: 'members', value: [{ value: 'u1' }] }])
    )
    expect(patch).toMatchObject({ kind: 'full', members: ['u1'] })
  })

  it('treats a valueless member removal as clearing the membership', () => {
    const patch = parseGroupPatch(parseOperations([{ op: 'remove', path: 'members' }]))
    expect(patch).toMatchObject({ kind: 'full', members: [] })
  })

  it('reads Okta’s rename, ignoring the id it echoes back', () => {
    const patch = parseGroupPatch(
      parseOperations([{ op: 'replace', value: { id: 'g1', displayName: 'Platform' } }])
    )
    expect(patch).toMatchObject({ kind: 'full', displayName: 'Platform' })
  })

  it('carries membership deltas that accompany a rename', () => {
    const patch = parseGroupPatch(
      parseOperations([
        { op: 'replace', path: 'displayName', value: 'Platform' },
        { op: 'add', path: 'members', value: [{ value: 'u3' }] },
      ])
    )
    expect(patch).toMatchObject({ kind: 'full', displayName: 'Platform', addMembers: ['u3'] })
  })

  it('refuses a remove with no path', () => {
    let scimType: string | undefined
    try {
      parseGroupPatch(parseOperations([{ op: 'remove', value: { members: [] } }]))
    } catch (error) {
      scimType = (error as ScimError).scimType
    }
    expect(scimType).toBe('noTarget')
  })

  it('refuses removing the display name', () => {
    let scimType: string | undefined
    try {
      parseGroupPatch(parseOperations([{ op: 'remove', path: 'displayName' }]))
    } catch (error) {
      scimType = (error as ScimError).scimType
    }
    expect(scimType).toBe('mutability')
  })

  it('refuses an unsupported path', () => {
    let scimType: string | undefined
    try {
      parseGroupPatch(parseOperations([{ op: 'replace', path: 'owner', value: 'u1' }]))
    } catch (error) {
      scimType = (error as ScimError).scimType
    }
    expect(scimType).toBe('invalidPath')
  })
})
