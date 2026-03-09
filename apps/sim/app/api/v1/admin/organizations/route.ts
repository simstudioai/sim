/**
 * GET /api/v1/admin/organizations
 *
 * List all organizations with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminOrganization>
 *
 * POST /api/v1/admin/organizations
 *
 * Create a new organization.
 *
 * Body:
 *   - name: string - Organization name (required)
 *   - slug: string - Organization slug (optional, auto-generated from name if not provided)
 *   - ownerId: string - User ID of the organization owner (required)
 *
 * Response: AdminSingleResponse<AdminOrganization & { memberId: string }>
 */

import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminOrganization,
  createPaginationMeta,
  parsePaginationParams,
  toAdminOrganization,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [countResult, organizations] = await Promise.all([
      db.select({ total: count() }).from(organization),
      db.select().from(organization).orderBy(organization.name).limit(limit).offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminOrganization[] = organizations.map(toAdminOrganization)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} organizations (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list organizations', { error })
    return internalErrorResponse('Failed to list organizations')
  }
})

export const POST = withAdminAuth(async (request) => {
  try {
    const body = await request.json()

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return badRequestResponse('name is required')
    }

    if (!body.ownerId || typeof body.ownerId !== 'string') {
      return badRequestResponse('ownerId is required')
    }

    const [ownerData] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.id, body.ownerId))
      .limit(1)

    if (!ownerData) {
      return notFoundResponse('Owner user')
    }

    const [existingMembership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, body.ownerId))
      .limit(1)

    if (existingMembership) {
      return badRequestResponse(
        'User is already a member of another organization. Users can only belong to one organization at a time.'
      )
    }

    const name = body.name.trim()
    const slug =
      body.slug?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

    const organizationId = randomUUID()
    const memberId = randomUUID()
    const now = new Date()

    await db.transaction(async (tx) => {
      await tx.insert(organization).values({
        id: organizationId,
        name,
        slug,
        createdAt: now,
        updatedAt: now,
      })

      await tx.insert(member).values({
        id: memberId,
        userId: body.ownerId,
        organizationId,
        role: 'owner',
        createdAt: now,
      })
    })

    const [createdOrg] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    logger.info(`Admin API: Created organization ${organizationId}`, {
      name,
      slug,
      ownerId: body.ownerId,
      memberId,
    })

    return singleResponse({
      ...toAdminOrganization(createdOrg),
      memberId,
    })
  } catch (error) {
    logger.error('Admin API: Failed to create organization', { error })
    return internalErrorResponse('Failed to create organization')
  }
})
