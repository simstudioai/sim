import { NextResponse } from 'next/server'
import {
  type EnterpriseAuditContext,
  resolveEnterpriseAuditAccess,
} from '@/lib/audit-logs/authorization'
import {
  capabilityGovernedUserId,
  checkOrganizationPersonalKeyRefusal,
  type RateLimitResult,
} from '@/app/api/v1/middleware'

type AuthResult =
  | { success: true; context: EnterpriseAuditContext }
  | { success: false; response: NextResponse }

type V1AuthResult =
  | { success: true; userId: string; context: EnterpriseAuditContext }
  | { success: false; response: NextResponse }

/**
 * v1 wrapper: renders {@link resolveEnterpriseAuditAccess} as the v1 `{ error }`
 * response body.
 */
export async function validateEnterpriseAuditAccess(
  userId: string,
  targetOrganizationId?: string
): Promise<AuthResult> {
  const result = await resolveEnterpriseAuditAccess(userId, targetOrganizationId)
  if (result.success) return { success: true, context: result.context }
  return {
    success: false,
    response: NextResponse.json({ error: result.message }, { status: result.status }),
  }
}

/**
 * Authorizes a v1 API-key read of the organization audit trail with the same
 * policy as `auditLogOperations`, which v1 does not route through.
 *
 * Workspace keys are refused (`workspaceApiKey: 'deny'`): their `userId` is the
 * key's creator, so authorizing it would let a credential scoped to one
 * workspace read every workspace in the organization whenever its creator is an
 * organization admin. A personal key is then held to the user-global
 * `personal_api_key.use` group decision, checked after the admin role so the
 * refusal never describes an organization's configuration to a non-admin.
 */
export async function validateV1EnterpriseAuditAccess(
  rateLimit: RateLimitResult
): Promise<V1AuthResult> {
  const userId = capabilityGovernedUserId(rateLimit)
  if (!userId) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Audit logs require a personal API key' },
        { status: 403 }
      ),
    }
  }

  const access = await validateEnterpriseAuditAccess(userId)
  if (!access.success) return access

  const personalKeyRefusal = await checkOrganizationPersonalKeyRefusal(rateLimit)
  if (personalKeyRefusal) return { success: false, response: personalKeyRefusal }

  return { success: true, userId, context: access.context }
}
