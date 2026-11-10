import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, ne } from 'drizzle-orm'
import {
  acquireOrganizationMutationLock,
  acquireUserBillingIdentityLock,
} from '@/lib/billing/organizations/identity-lock'
import type { DbTransaction } from '@/lib/db/types'
import type { PersonalOrganizationAuditActor } from '@/lib/organizations/lifecycle-audit'
import {
  convertPersonalOrganizationToTeamTx,
  getPersonalOrganizationId,
} from '@/lib/organizations/personal'

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
  /** Who is starting the team, recorded when it converts the owner's personal organization. */
  actor: PersonalOrganizationAuditActor
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

export async function createOrganizationWithOwner(
  params: CreateOrganizationWithOwnerParams
): Promise<CreateOrganizationWithOwnerResult> {
  return db.transaction((tx) => createOrganizationWithOwnerTx(tx, params))
}

/**
 * Transaction-enlisted team organization creation. An owner who has a personal organization
 * starts the team from it: it becomes the team in place, keeping its id and organization-level
 * content, and its workspaces return to the organization-less personal state for the caller's
 * usual attach, exactly as an owner's personal workspaces were before personal organizations.
 *
 * `organization.slug` has no unique constraint, so the slug check here is only
 * as strong as the transaction it runs in. A caller that needs the check and
 * the insert to be atomic against other processes — provisioning a
 * well-known slug from several replicas, for instance — must hold its own
 * advisory lock for the life of the transaction it passes in. Splitting the
 * check and the insert across two transactions allows duplicate slugs.
 */
export async function createOrganizationWithOwnerTx(
  tx: DbTransaction,
  { ownerUserId, name, slug, metadata = {}, actor }: CreateOrganizationWithOwnerParams
): Promise<CreateOrganizationWithOwnerResult> {
  validateOrganizationSlugOrThrow(slug)

  const organizationId = `org_${generateId()}`
  const memberId = generateId()
  const now = new Date()

  /**
   * A personal organization's lock precedes the owner's billing-identity lock, the order
   * workspace creation inside it takes them in.
   */
  const personalOrganizationId = await getPersonalOrganizationId(ownerUserId, tx)
  if (personalOrganizationId) await acquireOrganizationMutationLock(tx, personalOrganizationId)
  await acquireUserBillingIdentityLock(tx, ownerUserId)
  const existingOrganization = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)

  if (existingOrganization.length > 0) {
    throw new OrganizationSlugTakenError(slug)
  }

  const converted = await convertPersonalOrganizationToTeamTx(tx, {
    userId: ownerUserId,
    name,
    slug,
    metadata,
    actor,
  })
  if (converted) {
    return { organizationId: converted.organizationId, memberId: converted.memberId }
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

  return { organizationId, memberId }
}
