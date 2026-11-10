/**
 * The Admin API against real PostgreSQL once every account has a personal organization: listings
 * default to teams and say which kind each organization is, a personal organization cannot be
 * renamed, deleted, or given team configuration by hand (it converts or retires with its owner),
 * and an account in one can still be made the owner of a new team.
 */
import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ADMIN_API_KEY = 'personal-org-admin-fixture-key'
})

import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { PATCH as patchDataRetention } from '@/app/api/v1/admin/organizations/[id]/data-retention/route'
import { DELETE, PATCH } from '@/app/api/v1/admin/organizations/[id]/route'
import { PATCH as patchSessionPolicy } from '@/app/api/v1/admin/organizations/[id]/session-policy/route'
import { PATCH as patchWhitelabel } from '@/app/api/v1/admin/organizations/[id]/whitelabel/route'
import { GET, POST } from '@/app/api/v1/admin/organizations/route'

const userIds: string[] = []
const headers = {
  'content-type': 'application/json',
  'x-admin-key': 'personal-org-admin-fixture-key',
}

async function personalOrganizationOwner() {
  const userId = `admin-personal-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Admin Personal Test',
    email: `${userId}@admin-personal.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  userIds.push(userId)
  const organizationId = await createPersonalOrganization(userId)
  if (!organizationId) throw new Error('expected a personal organization')
  const [row] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return { userId, organizationId, slug: row.slug }
}

function organizationRoute(organizationId: string, init: { method: string; search?: string }) {
  return [
    new NextRequest(
      `http://localhost:3000/api/v1/admin/organizations/${organizationId}${init.search ?? ''}`,
      {
        method: init.method,
        headers,
        ...(init.method === 'PATCH' ? { body: '{"name":"Renamed"}' } : {}),
      }
    ),
    { params: Promise.resolve({ id: organizationId }) },
  ] as const
}

afterAll(async () => {
  if (userIds.length === 0) return
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  if (organizations.length > 0) {
    await db.delete(organization).where(
      inArray(
        organization.id,
        organizations.map((row) => row.id)
      )
    )
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('Admin API with personal organizations', () => {
  it('lists teams by default and personal organizations only when asked, naming each kind', async () => {
    const { organizationId } = await personalOrganizationOwner()
    /** Every page: listings sort by name, so one page of a shared database can miss the row. */
    const list = async (search: string) => {
      const rows: Array<{ id: string; kind: string }> = []
      for (let offset = 0; ; offset += 250) {
        const response = await GET(
          new NextRequest(
            `http://localhost:3000/api/v1/admin/organizations?limit=250&offset=${offset}${search}`,
            { headers }
          ),
          {}
        )
        const body = (await response.json()) as { data: Array<{ id: string; kind: string }> }
        rows.push(...body.data)
        if (body.data.length < 250) return rows
      }
    }

    expect((await list('')).some((row) => row.id === organizationId)).toBe(false)
    expect((await list('')).every((row) => row.kind === 'team')).toBe(true)
    expect((await list('&kind=personal')).find((row) => row.id === organizationId)).toMatchObject({
      kind: 'personal',
    })
  })

  it('refuses to rename or delete a personal organization', async () => {
    const { organizationId, slug } = await personalOrganizationOwner()

    const renamed = await PATCH(...organizationRoute(organizationId, { method: 'PATCH' }))
    const deleted = await DELETE(
      ...organizationRoute(organizationId, { method: 'DELETE', search: `?confirmSlug=${slug}` })
    )

    expect(renamed.status).toBe(409)
    expect(deleted.status).toBe(409)
    const [kept] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(kept).toBeDefined()
    expect(kept.name).not.toBe('Renamed')
  })

  it('makes an account in a personal organization the owner of a new team, in place', async () => {
    const { userId, organizationId } = await personalOrganizationOwner()

    const response = await POST(
      new NextRequest('http://localhost:3000/api/v1/admin/organizations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Admin Team', ownerId: userId }),
      }),
      {}
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { id: string; kind: string } }
    expect(body.data).toMatchObject({ id: organizationId, kind: 'team' })
  })

  it.each([
    {
      path: 'data-retention',
      patch: patchDataRetention,
      body: { logRetentionHours: 24 },
      column: organization.dataRetentionSettings,
    },
    {
      path: 'session-policy',
      patch: patchSessionPolicy,
      body: { maxSessionHours: 72, idleTimeoutHours: 48 },
      column: organization.sessionPolicySettings,
    },
    {
      path: 'whitelabel',
      patch: patchWhitelabel,
      body: { brandName: 'Acme' },
      column: organization.whitelabelSettings,
    },
  ])(
    'refuses $path team configuration on a personal organization',
    async ({ path, patch, body, column }) => {
      const { organizationId } = await personalOrganizationOwner()
      const readColumn = async () => {
        const [row] = await db
          .select({ value: column, updatedAt: organization.updatedAt })
          .from(organization)
          .where(eq(organization.id, organizationId))
        return row
      }
      const before = await readColumn()

      const response = await patch(
        new NextRequest(
          `http://localhost:3000/api/v1/admin/organizations/${organizationId}/${path}`,
          { method: 'PATCH', headers, body: JSON.stringify(body) }
        ),
        { params: Promise.resolve({ id: organizationId }) }
      )

      expect(response.status).toBe(409)
      expect(await readColumn()).toEqual(before)
    }
  )
})
