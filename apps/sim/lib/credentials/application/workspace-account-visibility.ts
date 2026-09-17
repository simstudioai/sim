import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { resourceScopeFromOwner, sameResourceScope } from '@/lib/core/resource-scope'
import {
  type OrganizationAccountAccessPolicy,
  organizationAccountAccessPolicyCodec,
  organizationAccountPolicyAllowsWorkspace,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { organizationOAuthCredentialType } from '@/lib/credential-groups/credential-types'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

/** Applies organization grants after the calling application operation authorizes workspace access. */
export async function filterWorkspaceAccountCredentials<
  T extends { id: string; type: string; providerId: string },
>(context: WorkspaceAuthorizationContext, credentials: T[]): Promise<T[]> {
  const managedIds = credentials
    .filter((entry) => entry.type === 'managed_oauth' || entry.type === 'personal_token')
    .map((entry) => entry.id)
  if (!managedIds.length) return credentials
  const bindings = await db
    .select({
      id: credential.id,
      organizationId: credential.organizationId,
      workspaceId: credential.workspaceId,
      groupId: credentialGroup.id,
      groupOrganizationId: credentialGroup.organizationId,
      groupWorkspaceId: credentialGroup.workspaceId,
      providerId: credential.providerId,
      type: credential.type,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(inArray(credential.id, managedIds))
  for (const binding of bindings) {
    if (
      !sameResourceScope(
        resourceScopeFromOwner(binding),
        resourceScopeFromOwner({
          organizationId: binding.groupOrganizationId,
          workspaceId: binding.groupWorkspaceId,
        })
      )
    )
      throw new Error('Credential and enrollment group owners do not match')
  }
  const byId = new Map(bindings.map((binding) => [binding.id, binding]))
  const policies = new Map<string, OrganizationAccountAccessPolicy>()
  const organizationId = context.workspaceOrganizationId
  const organizationAvailable =
    organizationId && bindings.some((binding) => binding.organizationId === organizationId)
      ? await isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId })
      : false
  for (const binding of bindings) {
    if (
      !binding.organizationId ||
      binding.organizationId !== organizationId ||
      !organizationAvailable ||
      policies.has(binding.groupId)
    )
      continue
    const policy = await requireResourcePolicy({
      organizationId: binding.organizationId,
      resourceType: 'credential_group',
      resourceId: binding.groupId,
      codec: organizationAccountAccessPolicyCodec,
    })
    policies.set(binding.groupId, policy.document)
  }
  return credentials.filter((entry) => {
    if (entry.type !== 'managed_oauth' && entry.type !== 'personal_token') return true
    const binding = byId.get(entry.id)
    if (!binding) return false
    if (!binding.organizationId) return binding.workspaceId === context.workspaceId
    if (binding.organizationId !== organizationId || !organizationAvailable) return false
    const policy = policies.get(binding.groupId)
    if (!policy) throw new Error('Organization credential policy was not loaded')
    if (
      !binding.providerId ||
      binding.providerId !== entry.providerId ||
      binding.type !== entry.type
    )
      throw new Error('Credential binding changed while listing accounts')
    if (binding.type === 'personal_token' && binding.providerId !== 'gitlab')
      throw new Error('Unsupported personal-token provider')
    const type =
      binding.type === 'personal_token'
        ? 'personal_token:gitlab'
        : organizationOAuthCredentialType(binding.providerId)
    return organizationAccountPolicyAllowsWorkspace(policy, context.workspaceId, type)
  })
}
