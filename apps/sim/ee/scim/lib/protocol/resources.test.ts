/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { scimUserResourceSchema } from '@/lib/api/contracts/scim'
import { SCIM_MAX_PAGE_SIZE } from '@/ee/scim/lib/protocol/constants'
import type { ScimError } from '@/ee/scim/lib/protocol/errors'
import {
  parseAttributeProjection,
  projectionWants,
  projectResource,
  resolvePage,
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
