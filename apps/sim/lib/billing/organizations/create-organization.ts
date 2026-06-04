import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, ne } from 'drizzle-orm'

const ORGANIZATION_SLUG_REGEX = /^[a-z0-9-_]+$/

export class OrganizationSlugInvalidError extends Error {
  constructor(slug: string) {
    super(`Organization slug "${slug}" is invalid`)
    this.name = 'OrganizationSlugInvalidError'
  }
}

export class OrganizationSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Organization slug "${slug}" is already taken`)
    this.name = 'OrganizationSlugTakenError'
  }
}

interface CreateOrganizationWithOwnerParams {
  ownerUserId: string
  name: string
  slug: string
  metadata?: Record<string, unknown>
}

interface EnsureOrganizationSlugAvailableParams {
  slug: string
  excludeOrganizationId?: string
}

interface CreateOrganizationWithOwnerResult {
  organizationId: string
  memberId: string
}

export function validateOrganizationSlugOrThrow(slug: string): void {
  if (!ORGANIZATION_SLUG_REGEX.test(slug)) {
    throw new OrganizationSlugInvalidError(slug)
  }
}

export async function ensureOrganizationSlugAvailable({
  slug,
  excludeOrganizationId,
}: EnsureOrganizationSlugAvailableParams): Promise<void> {
  const whereClause = excludeOrganizationId
    ? and(eq(organization.slug, slug), ne(organization.id, excludeOrganizationId))
    : eq(organization.slug, slug)

  const existingOrganization = await db
    .select({ id: organization.id })
    .from(organization)
    .where(whereClause)
    .limit(1)

  if (existingOrganization.length > 0) {
    throw new OrganizationSlugTakenError(slug)
  }
}

export async function createOrganizationWithOwner({
  ownerUserId,
  name,
  slug,
  metadata = {},
}: CreateOrganizationWithOwnerParams): Promise<CreateOrganizationWithOwnerResult> {
  validateOrganizationSlugOrThrow(slug)

  const organizationId = `org_${generateId()}`
  const memberId = generateId()
  const now = new Date()

  await db.transaction(async (tx) => {
    const whereClause = eq(organization.slug, slug)
    const existingOrganization = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(whereClause)
      .limit(1)

    if (existingOrganization.length > 0) {
      throw new OrganizationSlugTakenError(slug)
    }

    await tx.insert(organization).values({
      id: organizationId,
      name,
      slug,
      metadata,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(member).values({
      id: memberId,
      userId: ownerUserId,
      organizationId,
      role: 'owner',
      createdAt: now,
    })
  })

  return {
    organizationId,
    memberId,
  }
}
