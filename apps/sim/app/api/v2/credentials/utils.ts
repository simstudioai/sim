import type { NextResponse } from 'next/server'
import type { V2Credential } from '@/lib/api/contracts/v2/credentials'
import type { CredentialOrchestrationErrorCode } from '@/lib/credentials/orchestration'
import type { CredentialRow, VisibleWorkspaceCredential } from '@/lib/credentials/queries'
import { v2Error } from '@/app/api/v2/lib/response'

/**
 * Shared serialization + error mapping for the v2 credentials surface.
 *
 * Both projections are written field by field on purpose: a credential row
 * carries `encryptedServiceAccountKey`, and spreading the row would put it one
 * forgotten `omit` away from the wire.
 */

export function toV2Credential(row: VisibleWorkspaceCredential): V2Credential {
  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    description: row.description,
    providerId: row.providerId,
    accountId: row.accountId,
    envKey: row.envKey,
    hasServiceAccountKey: row.hasServiceAccountKey,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Projection for a raw credential row, whose caller-role is resolved separately. */
export function toV2CredentialRow(row: CredentialRow, role: V2Credential['role']): V2Credential {
  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    description: row.description,
    providerId: row.providerId,
    accountId: row.accountId,
    envKey: row.envKey,
    hasServiceAccountKey: Boolean(row.encryptedServiceAccountKey),
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Renders a credential orchestration failure in the v2 error envelope.
 *
 * `forbidden` from the orchestration means "not an admin of this credential",
 * which is a resource-level denial rather than a workspace one; it stays a 403
 * because the caller already proved workspace access to reach it.
 */
export function v2CredentialOrchestrationError(
  errorCode: CredentialOrchestrationErrorCode | undefined,
  message: string,
  options: { providerUnavailable?: boolean } = {}
): NextResponse {
  if (options.providerUnavailable) {
    return v2Error('SERVICE_UNAVAILABLE', 'The credential provider is unavailable. Try again.')
  }
  switch (errorCode) {
    case 'validation':
      return v2Error('BAD_REQUEST', message)
    case 'forbidden':
      return v2Error('FORBIDDEN', message)
    case 'not_found':
      return v2Error('NOT_FOUND', 'Credential not found')
    case 'conflict':
      return v2Error('CONFLICT', message)
    default:
      return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
}
