import { defineOperation } from '@/lib/core/application/operation'

/**
 * Admits a newly authenticated SSO identity before organization membership
 * exists. Workspace-role authorization cannot apply yet; the use case instead
 * proves the exact provider link, verified domain, and provider-bound target.
 */
// permission-group-exempt: SSO admission runs before any organization membership exists, so no group can govern the identity being admitted yet
export const ssoJitAdmissionOperation = defineOperation({
  id: 'sso.jit-admit',
  principalKinds: ['session'] as const,
  capability: 'none',
})
