import { NextResponse } from 'next/server'
import {
  type EnterpriseAuditContext,
  resolveEnterpriseAuditAccess,
} from '@/lib/audit-logs/authorization'

type AuthResult =
  | { success: true; context: EnterpriseAuditContext }
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
