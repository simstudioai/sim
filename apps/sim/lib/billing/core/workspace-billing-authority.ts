import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'

/**
 * Canonical workspace state needed to decide payer-billing authority.
 */
export interface WorkspaceBillingAuthorityContext {
  workspaceOrganizationId: string | null
  billedAccountUserId: string
}

/**
 * Server-side counterpart of `canManageWorkspaceBilling`, resolved from
 * canonical workspace state instead of a viewer-facing host context.
 *
 * An organization-hosted workspace answers to its organization admins; a
 * personally hosted workspace answers only to its billed account holder. A
 * plain workspace `admin` is deliberately not sufficient: workspace roles
 * govern the workspace's resources, not the payer's pooled credit and storage
 * allowances, which are shared across every workspace the payer funds.
 */
export async function canUserManageWorkspaceBilling(
  context: WorkspaceBillingAuthorityContext,
  userId: string
): Promise<boolean> {
  if (context.workspaceOrganizationId) {
    const [membership] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, context.workspaceOrganizationId), eq(member.userId, userId))
      )
      .limit(1)
    return isOrgAdminRole(membership?.role)
  }

  return context.billedAccountUserId === userId
}
