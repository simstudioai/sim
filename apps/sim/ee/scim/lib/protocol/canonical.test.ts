import { describe, expect, it } from 'vitest'
import { scimGroupWriteSchema, scimUserWriteSchema } from '@/lib/api/contracts/scim'
import {
  accountName,
  primaryEmail,
  toCanonicalGroup,
  toCanonicalUser,
} from '@/ee/scim/lib/protocol/canonical'
import { SCIM_GROUP_SCHEMA, SCIM_USER_SCHEMA } from '@/ee/scim/lib/protocol/constants'
import type { ScimError } from '@/ee/scim/lib/protocol/errors'
import { ENTRA_LEGACY_GROUP_SCHEMA } from '@/ee/scim/lib/protocol/normalize'

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

  it('uses name parts for the account without inventing a provider display name', () => {
    const user = parseUser({
      userName: 'ada@acme.test',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    })
    expect(user.name.formatted).toBe('Ada Lovelace')
    expect(user).not.toHaveProperty('displayName')
    expect(accountName(user)).toBe('Ada Lovelace')
  })

  it('prefers an explicit display name while retaining the independent formatted name', () => {
    const user = parseUser({
      userName: 'ada@acme.test',
      displayName: 'Countess Lovelace',
      name: { formatted: 'Ada Lovelace', givenName: 'Augusta', familyName: 'King' },
    })
    expect(accountName(user)).toBe('Countess Lovelace')
    expect(user.name.formatted).toBe('Ada Lovelace')
  })

  it('keeps a provider extension’s attributes under its URN', () => {
    const user = parseUser({
      userName: 'ada@acme.test',
      'urn:okta:sim:2.0:user:custom': { costCenter: 'R&D' },
    })
    expect(user.extra).toEqual({ 'urn:okta:sim:2.0:user:custom': { costCenter: 'R&D' } })
  })

  it('never keeps a password, even though Okta always sends one', () => {
    const user = parseUser({ userName: 'ada@acme.test', password: 'hunter2' })
    expect(JSON.stringify(user)).not.toContain('hunter2')
  })

  it.each(['Password', 'urn:ietf:params:scim:schemas:core:2.0:User:password'])(
    'also strips the write-only password attribute %s',
    (attribute) => {
      const user = parseUser({ userName: 'ada@acme.test', [attribute]: 'synthetic-password' })
      expect(JSON.stringify(user)).not.toContain('synthetic-password')
    }
  )

  it('accepts Entra’s string boolean for active', () => {
    expect(parseUser({ userName: 'ada@acme.test', active: 'False' }).active).toBe(false)
  })
})

describe('schemas declaration', () => {
  it('refuses a User without the core schema', () => {
    const result = scimUserWriteSchema.safeParse({
      schemas: ['urn:okta:sim:2.0:user:custom'],
      userName: 'ada@acme.test',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(`schemas must include ${SCIM_USER_SCHEMA}`)
  })

  it('tolerates Microsoft’s legacy Group schema marker', () => {
    expect(
      scimGroupWriteSchema.safeParse({
        schemas: [SCIM_GROUP_SCHEMA, ENTRA_LEGACY_GROUP_SCHEMA],
        displayName: 'Engineering',
      }).success
    ).toBe(true)
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
