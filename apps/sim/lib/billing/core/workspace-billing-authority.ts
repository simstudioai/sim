import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

/**
 * Canonical workspace state needed to decide payer-billing authority.
 */
export interface WorkspaceBillingAuthorityContext {
  workspaceOrganizationId: string | null
  billedAccountUserId: string
}

/**
 * Resolves whether a user holds billing authority over the entity that funds a
 * pool — the single predicate every payer-pool disclosure is gated on.
 *
 * An organization pool answers to that organization's admins and owners; a
 * personal pool answers only to the account holder it belongs to. Membership
 * alone is never sufficient: an organization's credit and storage allowances
 * are pooled across every member and workspace it funds, so projecting them to
 * a plain member discloses the whole organization's consumption.
 */
export async function canUserManageBillingEntity(
  billingEntity: Readonly<BillingEntity>,
  userId: string
): Promise<boolean> {
  if (billingEntity.type === 'organization') {
    return isOrganizationAdminOrOwner(userId, billingEntity.id)
  }

  return billingEntity.id === userId
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
  return canUserManageBillingEntity(
    context.workspaceOrganizationId
      ? { type: 'organization', id: context.workspaceOrganizationId }
      : { type: 'user', id: context.billedAccountUserId },
    userId
  )
}
