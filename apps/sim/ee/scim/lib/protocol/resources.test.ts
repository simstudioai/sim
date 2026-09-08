/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { scimGroupResourceSchema, scimUserResourceSchema } from '@/lib/api/contracts/scim'
import { SCIM_MAX_PAGE_SIZE } from '@/ee/scim/lib/protocol/constants'
import type { ScimError } from '@/ee/scim/lib/protocol/errors'
import {
  parseAttributeProjection,
  projectionWants,
  projectResource,
  resolvePage,
  toGroupResource,
  toUserResource,
} from '@/ee/scim/lib/protocol/resources'

const BASE_URL = 'https://sim.test/api/scim/v2'

function userRow() {
  return {
    id: 'su1',
    externalId: '00u1',
    userName: 'ada@acme.test',
    active: true,
    attributes: {
      userName: 'ada@acme.test',
      active: true,
      displayName: 'Ada Lovelace',
      name: { formatted: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' },
      emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    email: 'ada@acme.test',
    groups: [{ id: 'g1', displayName: 'Engineering' }],
  }
}

describe('resolvePage', () => {
  it('defaults to the first page at the maximum size', () => {
    expect(resolvePage({})).toEqual({
      startIndex: 1,
      offset: 0,
      count: SCIM_MAX_PAGE_SIZE,
    })
  })

  it('clamps a zero startIndex up, because Okta sends one on its first import page', () => {
    expect(resolvePage({ startIndex: 0 })).toMatchObject({ startIndex: 1, offset: 0 })
  })

  it('caps the page size so one request cannot ask for an unbounded read', () => {
    expect(resolvePage({ count: 5000 }).count).toBe(SCIM_MAX_PAGE_SIZE)
  })

  it('allows a zero count, which Entra uses to ask only for the total', () => {
    expect(resolvePage({ count: 0 }).count).toBe(0)
  })
})

describe('toUserResource', () => {
  it('renders the resource a provider expects', () => {
    const resource = toUserResource(userRow(), BASE_URL)
    expect(resource).toMatchObject({
      id: 'su1',
      externalId: '00u1',
      userName: 'ada@acme.test',
      active: true,
      meta: {
        resourceType: 'User',
        location: `${BASE_URL}/Users/su1`,
        lastModified: '2026-02-01T00:00:00.000Z',
      },
    })
    expect(resource.groups).toEqual([
      { value: 'g1', display: 'Engineering', $ref: `${BASE_URL}/Groups/g1` },
    ])
  })

  it('declares a provider extension it stored and returns its attributes', () => {
    const base = userRow()
    const row = {
      ...base,
      attributes: {
        ...base.attributes,
        extra: { 'urn:okta:sim:2.0:user:custom': { costCenter: 'R&D' } },
      },
    }
    const resource = toUserResource(row, BASE_URL)
    expect(resource.schemas).toContain('urn:okta:sim:2.0:user:custom')
    expect(resource['urn:okta:sim:2.0:user:custom']).toEqual({ costCenter: 'R&D' })
    expect(scimUserResourceSchema.safeParse(resource).success).toBe(true)
  })

  it('reports the Sim account address rather than a stale stored copy', () => {
    const row = { ...userRow(), email: 'moved@acme.test' }
    expect(toUserResource(row, BASE_URL).emails[0]).toMatchObject({
      value: 'moved@acme.test',
      primary: true,
    })
  })

  it('never returns a password from legacy stored extra attributes', () => {
    const base = userRow()
    const resource = toUserResource(
      {
        ...base,
        attributes: {
          ...base.attributes,
          extra: {
            password: 'synthetic-password',
            Password: 'synthetic-password',
            'urn:ietf:params:scim:schemas:core:2.0:User:password': 'synthetic-password',
            title: 'Analyst',
          },
        },
      },
      BASE_URL
    )
    expect(resource.title).toBe('Analyst')
    expect(JSON.stringify(resource)).not.toContain('synthetic-password')
    expect(resource.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User'])
  })
})

describe('attribute projection', () => {
  it('keeps a projected resource valid against the response contract', () => {
    const excluded = parseAttributeProjection({ excludedAttributes: 'groups,emails' })
    const projected = projectResource(toUserResource(userRow(), BASE_URL), excluded)
    expect(() => scimUserResourceSchema.parse(projected)).not.toThrow()

    const only = parseAttributeProjection({ attributes: 'userName' })
    const narrow = projectResource(toUserResource(userRow(), BASE_URL), only)
    expect(() => scimUserResourceSchema.parse(narrow)).not.toThrow()
    expect(narrow).not.toHaveProperty('emails')
  })

  it('honours the members exclusion Entra sends on every group list', () => {
    const projection = parseAttributeProjection({ excludedAttributes: 'members' })
    expect(projectionWants(projection, 'members')).toBe(false)
    expect(projectionWants(projection, 'displayName')).toBe(true)
  })

  it('keeps schemas, id and meta whatever the request asked for', () => {
    const projection = parseAttributeProjection({ attributes: 'userName' })
    const projected = projectResource(toUserResource(userRow(), BASE_URL), projection)
    expect(Object.keys(projected).sort()).toEqual(['id', 'meta', 'schemas', 'userName'])
  })

  it.each(['name.givenName', 'urn:ietf:params:scim:schemas:core:2.0:User:name.givenName'])(
    'returns the requested name sub-attribute %s',
    (attributes) => {
      const projected = projectResource(
        toUserResource(userRow(), BASE_URL),
        parseAttributeProjection({ attributes })
      )
      expect(projected.name).toEqual({ givenName: 'Ada' })
      expect(projected).not.toHaveProperty('emails')
      expect(scimUserResourceSchema.safeParse(projected).success).toBe(true)
    }
  )

  it('excludes a nested name attribute without dropping its siblings', () => {
    const projected = projectResource(
      toUserResource(userRow(), BASE_URL),
      parseAttributeProjection({ excludedAttributes: 'name.formatted' })
    )
    expect(projected.name).toEqual({ givenName: 'Ada', familyName: 'Lovelace' })
    expect(scimUserResourceSchema.safeParse(projected).success).toBe(true)
  })

  it.each([
    'userName.foo',
    'active.foo',
    'name.givenName.foo',
    'emails.value.foo',
    'groups.value.foo',
    'urn:ietf:params:scim:schemas:core:2.0:User:USERNAME.foo',
    'urn:okta:sim:2.0:user:custom:costCenter.foo',
    'urn:okta:sim:2.0:user:custom:tags.foo',
  ])('does not return scalar values for a nonexistent descendant %s', (attributes) => {
    const base = userRow()
    const resource = toUserResource(
      {
        ...base,
        attributes: {
          ...base.attributes,
          extra: { 'urn:okta:sim:2.0:user:custom': { costCenter: 'R&D', tags: ['staff'] } },
        },
      },
      BASE_URL
    )
    const projected = projectResource(resource, parseAttributeProjection({ attributes }))
    expect(Object.keys(projected).sort()).toEqual(['id', 'meta', 'schemas'])
    expect(scimUserResourceSchema.safeParse(projected).success).toBe(true)
  })

  it('omits arrays with no matching sub-attributes while retaining valid selections', () => {
    const projected = projectResource(
      toUserResource(userRow(), BASE_URL),
      parseAttributeProjection({ attributes: 'emails.unknown,name.givenName.foo,name.familyName' })
    )
    expect(projected).not.toHaveProperty('emails')
    expect(projected.name).toEqual({ familyName: 'Lovelace' })
  })

  it('keeps explicitly selected parents even when nonexistent descendants are also requested', () => {
    const resource = toUserResource(userRow(), BASE_URL)
    const projected = projectResource(
      resource,
      parseAttributeProjection({
        attributes: 'userName,userName.foo,name,name.givenName.foo,emails,emails.value.foo',
      })
    )
    expect(projected.userName).toBe(resource.userName)
    expect(projected.name).toEqual(resource.name)
    expect(projected.emails).toEqual(resource.emails)
  })

  it('ignores exclusions of nonexistent scalar descendants', () => {
    const resource = toUserResource(userRow(), BASE_URL)
    const projected = projectResource(
      resource,
      parseAttributeProjection({
        excludedAttributes: 'userName.foo,name.givenName.foo,emails.value.foo',
      })
    )
    expect(projected).toEqual(resource)
  })

  it('keeps an explicitly selected empty multi-valued attribute', () => {
    const resource = toUserResource({ ...userRow(), groups: [] }, BASE_URL)
    const projected = projectResource(resource, parseAttributeProjection({ attributes: 'groups' }))
    expect(projected.groups).toEqual([])
  })

  it('projects each multi-valued entry and still loads requested group sub-attributes', () => {
    const projection = parseAttributeProjection({ attributes: 'emails.value,groups.value' })
    const projected = projectResource(toUserResource(userRow(), BASE_URL), projection)
    expect(projectionWants(projection, 'groups')).toBe(true)
    expect(projected.emails).toEqual([{ value: 'ada@acme.test' }])
    expect(projected.groups).toEqual([{ value: 'g1' }])
    expect(scimUserResourceSchema.safeParse(projected).success).toBe(true)
  })

  it('projects group member sub-attributes through the response contract', () => {
    const projection = parseAttributeProjection({ attributes: 'members.value' })
    const resource = toGroupResource(
      {
        id: 'g1',
        externalId: null,
        displayName: 'Engineering',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        members: [{ scimUserId: 'su1', displayName: 'Ada Lovelace' }],
      },
      BASE_URL
    )
    const projected = projectResource(resource, projection)
    expect(projectionWants(projection, 'members')).toBe(true)
    expect(projected.members).toEqual([{ value: 'su1' }])
    expect(scimGroupResourceSchema.safeParse(projected).success).toBe(true)
  })

  it('projects a schema-qualified extension attribute', () => {
    const schema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
    const base = userRow()
    const resource = toUserResource(
      {
        ...base,
        attributes: { ...base.attributes, enterprise: { department: 'Maths', costCenter: '123' } },
      },
      BASE_URL
    )
    const projected = projectResource(
      resource,
      parseAttributeProjection({ attributes: `${schema}:department` })
    )
    expect(projected[schema]).toEqual({ department: 'Maths' })
    expect(projected).not.toHaveProperty('name')
    expect(scimUserResourceSchema.safeParse(projected).success).toBe(true)
  })

  it('refuses combining an include list with an exclude list', () => {
    let scimType: string | undefined
    try {
      parseAttributeProjection({ attributes: 'userName', excludedAttributes: 'groups' })
    } catch (error) {
      scimType = (error as ScimError).scimType
    }
    expect(scimType).toBe('invalidValue')
  })
})
