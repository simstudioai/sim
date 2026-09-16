/**
 * @vitest-environment node
 */
import type { ScimUserAttributes } from '@sim/db/schema'
import { describe, expect, it } from 'vitest'
import { scimPatchBodySchema } from '@/lib/api/contracts/scim'
import { SCIM_PATCH_OP_SCHEMA } from '@/ee/scim/lib/protocol/constants'
import { applyUserPatch } from '@/ee/scim/lib/protocol/user-patch'

/**
 * Covers RFC 7644 operation semantics and the request variants documented by
 * Okta and Microsoft Entra.
 */

function baseUser(overrides: Partial<ScimUserAttributes> = {}): ScimUserAttributes {
  return {
    userName: 'ada@acme.test',
    externalId: '00u1',
    active: true,
    displayName: 'Ada Lovelace',
    displayNameSource: 'provider',
    name: { formatted: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' },
    emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
    ...overrides,
  }
}

/** Parses through the real contract so the tests exercise the tolerances too. */
function parseOperations(operations: unknown[]) {
  return scimPatchBodySchema.parse({ schemas: [SCIM_PATCH_OP_SCHEMA], Operations: operations })
    .Operations
}

describe('applyUserPatch', () => {
  it('removes a display name without synthesizing it again on a later name-part patch', () => {
    const removed = applyUserPatch(baseUser(), [{ op: 'remove', path: 'displayName' }])
    expect(removed.next.displayName).toBeUndefined()
    expect(removed.next.displayNameSource).toBeUndefined()
    const repeated = applyUserPatch(removed.next, [{ op: 'remove', path: 'displayName' }])
    expect(repeated.changed).toBe(false)
    const renamed = applyUserPatch(repeated.next, [
      { op: 'replace', path: 'name.givenName', value: 'Augusta' },
    ])
    expect(renamed.next.name.formatted).toBe('Augusta Lovelace')
    expect(renamed.next.displayName).toBeUndefined()
  })
  it('deactivates from Okta’s path-less replace', () => {
    const { next, changed } = applyUserPatch(
      baseUser(),
      parseOperations([{ op: 'replace', value: { active: false } }])
    )
    expect(changed).toBe(true)
    expect(next.active).toBe(false)
  })

  it('deactivates from Entra’s capitalized op and string boolean', () => {
    const { next, changed } = applyUserPatch(
      baseUser(),
      parseOperations([{ op: 'Replace', path: 'active', value: 'False' }])
    )
    expect(changed).toBe(true)
    expect(next.active).toBe(false)
  })

  it('reactivates', () => {
    const { next } = applyUserPatch(
      baseUser({ active: false }),
      parseOperations([{ op: 'replace', value: { active: true } }])
    )
    expect(next.active).toBe(true)
  })

  it('applies Entra’s path-less replace with dotted attribute keys', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        {
          op: 'Replace',
          value: {
            'name.givenName': 'Augusta',
            'name.familyName': 'King',
            displayName: 'Augusta King',
          },
        },
      ])
    )
    expect(next.name.givenName).toBe('Augusta')
    expect(next.name.familyName).toBe('King')
    expect(next.name.formatted).toBe('Augusta King')
    expect(next.displayName).toBe('Augusta King')
  })

  it('creates a work email when the filtered path matches nothing', () => {
    const { next } = applyUserPatch(
      baseUser({ emails: [{ value: 'ada@acme.test', primary: true }] }),
      parseOperations([
        { op: 'replace', path: 'emails[type eq "work"].value', value: 'ada.k@acme.test' },
      ])
    )
    expect(next.emails).toContainEqual({ value: 'ada.k@acme.test', type: 'work', primary: false })
  })

  it('replaces an existing work email in place', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        { op: 'Replace', path: 'emails[type eq "work"].value', value: 'ADA.K@ACME.TEST' },
      ])
    )
    expect(next.emails).toEqual([{ value: 'ada.k@acme.test', type: 'work', primary: true }])
  })

  it('replaces the primary email through Entra’s primary filter', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        { op: 'replace', path: 'emails[primary eq true].value', value: 'new@acme.test' },
      ])
    )
    expect(next.emails[0].value).toBe('new@acme.test')
  })

  it('unwraps a single-element array around a scalar', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([{ op: 'replace', path: 'name.givenName', value: ['Augusta'] }])
    )
    expect(next.name.givenName).toBe('Augusta')
  })

  it('reads enterprise attributes under the URN-qualified path', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        {
          op: 'Replace',
          path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
          value: 'Analytical Engines',
        },
      ])
    )
    expect(next.enterprise?.department).toBe('Analytical Engines')
  })

  it('clears a manager when Entra sends an empty string', () => {
    const { next } = applyUserPatch(
      baseUser({ enterprise: { manager: { value: 'mgr-1' } } }),
      parseOperations([{ op: 'Replace', path: 'enterprise.manager', value: '' }])
    )
    expect(next.enterprise?.manager).toBeUndefined()
  })

  it('adds a secondary email without stealing the primary', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        { op: 'add', path: 'emails', value: [{ value: 'ada@home.test', type: 'home' }] },
      ])
    )
    expect(next.emails).toEqual([
      { value: 'ada@acme.test', type: 'work', primary: true },
      { value: 'ada@home.test', type: 'home', primary: false },
    ])
  })

  it('applies RFC 7644 canonical nesting in a path-less replace', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        {
          op: 'replace',
          value: {
            name: { givenName: 'Augusta' },
            'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'Maths' },
          },
        },
      ])
    )
    expect(next.name.givenName).toBe('Augusta')
    expect(next.name.formatted).toBe('Augusta Lovelace')
    expect(next.enterprise?.department).toBe('Maths')
  })

  it.each(['name', 'NAME', 'urn:ietf:params:scim:schemas:core:2.0:User:name'])(
    'updates the modelled name through the complex path %s',
    (path) => {
      const { next } = applyUserPatch(
        baseUser(),
        parseOperations([{ op: 'replace', path, value: { givenName: 'Augusta' } }])
      )
      expect(next.name).toEqual({
        givenName: 'Augusta',
        familyName: 'Lovelace',
        formatted: 'Augusta Lovelace',
      })
      expect(next.extra?.name).toBeUndefined()
    }
  )

  it('preserves an explicit formatted name in a complex name update', () => {
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([
        {
          op: 'add',
          path: 'name',
          value: { formatted: 'Countess Lovelace', givenName: 'Augusta' },
        },
      ])
    )
    expect(next.name).toEqual({
      givenName: 'Augusta',
      familyName: 'Lovelace',
      formatted: 'Countess Lovelace',
    })
  })

  it('updates a whole enterprise extension and preserves omitted attributes', () => {
    const { next } = applyUserPatch(
      baseUser({ enterprise: { department: 'Maths', employeeNumber: '123' } }),
      parseOperations([
        {
          op: 'replace',
          path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
          value: { department: 'Engineering' },
        },
      ])
    )
    expect(next.enterprise).toEqual({ department: 'Engineering', employeeNumber: '123' })
    expect(next.extra?.enterprise).toBeUndefined()
  })

  it.each([
    'password',
    'Password',
    'urn:ietf:params:scim:schemas:core:2.0:User:password',
    'URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:USER:PASSWORD',
  ])('never stores the write-only password path %s', (path) => {
    const original = baseUser()
    const targeted = applyUserPatch(
      original,
      parseOperations([{ op: 'replace', path, value: 'synthetic-password' }])
    )
    const pathless = applyUserPatch(
      original,
      parseOperations([{ op: 'add', value: { [path]: 'synthetic-password' } }])
    )
    expect(targeted).toEqual({ next: original, changed: false })
    expect(pathless).toEqual({ next: original, changed: false })
  })

  it('removes a previously persisted password when applying another update', () => {
    const { next, changed } = applyUserPatch(
      baseUser({ extra: { Password: 'synthetic-password', title: 'Analyst' } }),
      parseOperations([{ op: 'replace', path: 'active', value: true }])
    )
    expect(changed).toBe(true)
    expect(next.extra).toEqual({ title: 'Analyst' })
  })

  it('updates a custom extension through Entra’s qualified attribute path', () => {
    const schema = 'urn:ietf:params:scim:schemas:extension:CustomExtensionName:2.0:User'
    const { next } = applyUserPatch(
      baseUser({ extra: { [schema]: { tag: 'old', other: 'keep' } } }),
      parseOperations([{ op: 'Replace', path: `${schema}:tag`, value: 'new' }])
    )
    expect(next.extra).toEqual({ [schema]: { tag: 'new', other: 'keep' } })
  })

  it('adds a custom extension attribute on its first PATCH', () => {
    const schema = 'urn:ietf:params:scim:schemas:extension:CustomExtensionName:2.0:User'
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([{ op: 'add', path: `${schema}:tag`, value: 'new' }])
    )
    expect(next.extra).toEqual({ [schema]: { tag: 'new' } })
  })

  it('merges a path-less custom extension then removes one nested attribute', () => {
    const schema = 'urn:okta:sim:2.0:user:custom'
    const { next } = applyUserPatch(
      baseUser({ extra: { [schema]: { costCenter: 'R&D' } } }),
      parseOperations([
        { op: 'replace', value: { [schema]: { department: 'Engineering' } } },
        { op: 'remove', path: `${schema}:costCenter` },
      ])
    )
    expect(next.extra?.[schema]).toEqual({ department: 'Engineering', costCenter: undefined })
  })

  it('accepts a new extension object in a path-less PATCH', () => {
    const schema = 'urn:okta:sim:2.0:user:custom'
    const { next } = applyUserPatch(
      baseUser(),
      parseOperations([{ op: 'add', value: { [schema]: { costCenter: 'R&D' } } }])
    )
    expect(next.extra).toEqual({ [schema]: { costCenter: 'R&D' } })
  })

  it('removes a custom extension by its exact schema path', () => {
    const schema = 'urn:okta:sim:2.0:user:custom'
    const { next } = applyUserPatch(
      baseUser({ extra: { [schema]: { costCenter: 'R&D' }, title: 'Analyst' } }),
      parseOperations([{ op: 'remove', path: schema }])
    )
    expect(next.extra).toEqual({ title: 'Analyst' })
  })

  it('removes only the addressed sub-attribute of a typed complex attribute', () => {
    const { next } = applyUserPatch(
      baseUser({ extra: { addresses: [{ type: 'work', locality: 'London', country: 'GB' }] } }),
      parseOperations([{ op: 'remove', path: 'addresses[type eq "work"].locality' }])
    )
    expect(next.extra?.addresses).toEqual([{ type: 'work', locality: undefined, country: 'GB' }])
  })

  it('reports no change when a patch re-sends what is already stored', () => {
    const { changed } = applyUserPatch(
      baseUser(),
      parseOperations([
        { op: 'replace', value: { active: true } },
        { op: 'Replace', path: 'name.givenName', value: 'Ada' },
      ])
    )
    expect(changed).toBe(false)
  })

  it('defaults a missing op to replace, as Okta omits it', () => {
    const { next } = applyUserPatch(baseUser(), parseOperations([{ value: { active: false } }]))
    expect(next.active).toBe(false)
  })

  it('refuses a remove with no path', () => {
    expect(() =>
      applyUserPatch(baseUser(), parseOperations([{ op: 'remove', value: { active: false } }]))
    ).toThrowError(expect.objectContaining({ scimType: 'noTarget' }))
  })

  it('refuses writing a server-owned attribute', () => {
    expect(() =>
      applyUserPatch(baseUser(), parseOperations([{ op: 'replace', path: 'id', value: 'x' }]))
    ).toThrowError(expect.objectContaining({ scimType: 'mutability' }))
  })

  it('keeps attributes this server does not model, as a create would', () => {
    const { next, changed } = applyUserPatch(
      baseUser(),
      parseOperations([
        { op: 'replace', path: 'nickName', value: 'Ada' },
        { op: 'Add', path: 'phoneNumbers[type eq "work"].value', value: '+1 555 0100' },
        { op: 'replace', path: 'addresses[type eq "work"]', value: { locality: 'London' } },
        { op: 'replace', value: { title: 'Analyst', preferredLanguage: 'en-GB' } },
      ])
    )
    expect(changed).toBe(true)
    expect(next.extra).toEqual({
      nickName: 'Ada',
      title: 'Analyst',
      preferredLanguage: 'en-GB',
      phoneNumbers: [{ type: 'work', value: '+1 555 0100' }],
      addresses: [{ type: 'work', locality: 'London' }],
    })

    const removed = applyUserPatch(
      next,
      parseOperations([
        { op: 'remove', path: 'phoneNumbers[type eq "work"]' },
        { op: 'remove', path: 'nickName' },
      ])
    ).next
    expect(removed.extra?.phoneNumbers).toEqual([])
    expect(removed.extra?.nickName).toBeUndefined()
  })

  it('refuses a non-boolean active value', () => {
    expect(() =>
      applyUserPatch(baseUser(), parseOperations([{ op: 'replace', path: 'active', value: 'yes' }]))
    ).toThrowError(expect.objectContaining({ scimType: 'invalidValue' }))
  })

  it('leaves the stored resource untouched', () => {
    const original = baseUser()
    const snapshot = structuredClone(original)
    applyUserPatch(original, parseOperations([{ op: 'replace', value: { active: false } }]))
    expect(original).toEqual(snapshot)
  })
})
