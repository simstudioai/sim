/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { scimGroupWriteSchema, scimUserWriteSchema } from '@/lib/api/contracts/scim'
import {
  assertGroupSchemas,
  assertUserSchemas,
  primaryEmail,
  toCanonicalGroup,
  toCanonicalUser,
} from '@/lib/scim/protocol/canonical'
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_USER_SCHEMA,
} from '@/lib/scim/protocol/constants'
import type { ScimError } from '@/lib/scim/protocol/errors'
import { ENTRA_LEGACY_GROUP_SCHEMA } from '@/lib/scim/protocol/normalize'

function parseUser(body: Record<string, unknown>) {
  return toCanonicalUser(scimUserWriteSchema.parse({ schemas: [SCIM_USER_SCHEMA], ...body }))
}

describe('toCanonicalUser', () => {
  it('takes the flagged primary address', () => {
    const user = parseUser({
      userName: 'ada',
      emails: [
        { value: 'home@acme.test', primary: false },
        { value: 'work@acme.test', primary: true, type: 'work' },
      ],
    })
    expect(primaryEmail(user)).toBe('work@acme.test')
  })

  it('falls back to the first address when none is flagged, as OneLogin sends', () => {
    const user = parseUser({
      userName: 'ada',
      emails: [{ value: 'first@acme.test' }, { value: 'second@acme.test' }],
    })
    expect(primaryEmail(user)).toBe('first@acme.test')
  })

  it('falls back to an email-shaped userName, as Entra often sends alone', () => {
    const user = parseUser({ userName: 'Ada@Acme.Test' })
    expect(primaryEmail(user)).toBe('ada@acme.test')
    expect(user.userName).toBe('ada@acme.test')
  })

  it('refuses a resource with no usable address', () => {
    let scimType: string | undefined
    try {
      parseUser({ userName: 'ada' })
    } catch (error) {
      scimType = (error as ScimError).scimType
    }
    expect(scimType).toBe('invalidValue')
  })

  it('builds a display name from the parts when none is supplied', () => {
    const user = parseUser({
      userName: 'ada@acme.test',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    })
    expect(user.name.formatted).toBe('Ada Lovelace')
    expect(user.displayName).toBe('Ada Lovelace')
  })

  it('keeps attributes Sim does not model so responses round-trip them', () => {
    const user = parseUser({ userName: 'ada@acme.test', nickName: 'Countess' })
    expect(user.extra).toEqual({ nickName: 'Countess' })
  })

  it('never keeps a password, even though Okta always sends one', () => {
    const user = parseUser({ userName: 'ada@acme.test', password: 'hunter2' })
    expect(JSON.stringify(user)).not.toContain('hunter2')
  })

  it('accepts Entra’s string boolean for active', () => {
    expect(parseUser({ userName: 'ada@acme.test', active: 'False' }).active).toBe(false)
  })

  it('defaults active to true when omitted', () => {
    expect(parseUser({ userName: 'ada@acme.test' }).active).toBe(true)
  })
})

describe('schema assertions', () => {
  it('accepts the core User schema with the enterprise extension', () => {
    expect(() => assertUserSchemas([SCIM_USER_SCHEMA, SCIM_ENTERPRISE_USER_SCHEMA])).not.toThrow()
  })

  it('refuses an extension this server does not implement', () => {
    expect(() => assertUserSchemas([SCIM_USER_SCHEMA, 'urn:example:2.0:Custom'])).toThrow()
  })

  it('tolerates Microsoft’s legacy Group schema marker', () => {
    expect(() => assertGroupSchemas([SCIM_GROUP_SCHEMA, ENTRA_LEGACY_GROUP_SCHEMA])).not.toThrow()
  })
})

describe('toCanonicalGroup', () => {
  it('deduplicates member ids', () => {
    const group = toCanonicalGroup(
      scimGroupWriteSchema.parse({
        schemas: [SCIM_GROUP_SCHEMA],
        displayName: 'Engineering',
        members: [{ value: 'u1' }, { value: 'u1' }, { value: 'u2' }],
      })
    )
    expect(group.memberIds).toEqual(['u1', 'u2'])
  })

  it('refuses a nested group member', () => {
    let scimType: string | undefined
    try {
      toCanonicalGroup(
        scimGroupWriteSchema.parse({
          schemas: [SCIM_GROUP_SCHEMA],
          displayName: 'Engineering',
          members: [{ value: 'g2', type: 'Group' }],
        })
      )
    } catch (error) {
      scimType = (error as ScimError).scimType
    }
    expect(scimType).toBe('invalidValue')
  })
})
