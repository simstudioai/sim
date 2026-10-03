import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import type { z } from 'zod'
import { updateOrganizationBodySchema } from '@/lib/api/contracts/organization'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { organizationSettingsOperations } from '@/lib/organizations/application/operations'

export const organizationSettingsPatchSchema = updateOrganizationBodySchema.strict()
export type OrganizationSettingsPatch = z.output<typeof organizationSettingsPatchSchema>

export interface OrganizationSettingsValue {
  id: string
  name: string
  slug: string | null
  logo: string | null
  updatedAt: string
}

const settingsColumns = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  logo: organization.logo,
  updatedAt: organization.updatedAt,
}

function presentSettings(
  row: Omit<OrganizationSettingsValue, 'updatedAt'> & { updatedAt: Date }
): OrganizationSettingsValue {
  return { ...row, updatedAt: row.updatedAt.toISOString() }
}

export const readOrganizationSettings: OperationUseCase<
  typeof organizationSettingsOperations.read,
  { organizationId: string },
  OrganizationSettingsValue
> = {
  operation: organizationSettingsOperations.read,
  async execute({ principal, input }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationSettingsOperations.read,
      input
    )
    const [row] = await db
      .select(settingsColumns)
      .from(organization)
      .where(eq(organization.id, context.organizationId))
      .limit(1)
    if (!row) throw new OrchestrationError('not_found', 'Organization not found')
    return presentSettings(row)
  },
}

/** Keeps the metadata route's membership refusal while retaining current delegated scope checks. */
async function authorizeOrganizationSettingsUpdate(principal: Principal, organizationId: string) {
  try {
    return await authorizeOrganizationOperation(principal, organizationSettingsOperations.update, {
      organizationId,
    })
  } catch (error) {
    if (principal.kind === 'session' && error instanceof OrchestrationError) {
      if (error.code === 'not_found') {
        throw new OrchestrationError('forbidden', 'Forbidden - Not a member of this organization')
      }
      if (error.code === 'forbidden') {
        throw new OrchestrationError('forbidden', 'Forbidden - Admin access required')
      }
    }
    throw error
  }
}

export const updateOrganizationSettings: OperationUseCase<
  typeof organizationSettingsOperations.update,
  { organizationId: string; patch: OrganizationSettingsPatch },
  OrganizationSettingsValue
> = {
  operation: organizationSettingsOperations.update,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationSettingsUpdate(principal, input.organizationId)
    const parsed = organizationSettingsPatchSchema.safeParse(input.patch)
    if (!parsed.success) throw new OrchestrationError('validation', 'Invalid organization settings')
    const { name, slug, logo } = parsed.data
    if (name === undefined && slug === undefined && logo === undefined) {
      throw new OrchestrationError('validation', 'No valid fields provided for update')
    }
    if (slug !== undefined) {
      const [existing] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(and(eq(organization.slug, slug), ne(organization.id, context.organizationId)))
        .limit(1)
      if (existing) throw new OrchestrationError('validation', 'This slug is already taken')
    }
    const [updated] = await db
      .update(organization)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(organization.id, context.organizationId))
      .returning(settingsColumns)
    if (!updated) throw new OrchestrationError('not_found', 'Organization not found')
    recordProjectedUseCaseAuditEntries(
      organizationSettingsOperations.update,
      null,
      principal,
      request,
      [
        {
          action: AuditAction.ORGANIZATION_UPDATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: context.organizationId,
          resourceName: updated.name,
          description: 'Updated organization settings',
          metadata: { changes: { name, slug, logo } },
        },
      ],
      context.organizationId
    )
    return presentSettings(updated)
  },
}
