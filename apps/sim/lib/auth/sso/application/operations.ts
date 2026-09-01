import { defineOperation } from '@/lib/core/application/operation'

/**
 * Admits a newly authenticated SSO identity before organization membership
 * exists. Workspace-role authorization cannot apply yet; the use case instead
 * proves the exact provider link, verified domain, and provider-bound target.
 */
export const ssoJitAdmissionOperation = defineOperation({
  id: 'sso.jit-admit',
  principalKinds: ['session'] as const,
})
