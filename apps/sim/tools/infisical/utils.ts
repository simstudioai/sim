import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { normalizeHttpBaseUrl } from '@/lib/core/security/input-validation'
import type { InfisicalSecretApproval } from '@/tools/infisical/types'
import type { OutputProperty } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const INFISICAL_US_CLOUD_URL = 'https://us.infisical.com'

/**
 * An Infisical API URL on the configured instance. A blank instance URL means
 * US Cloud; any other is normalized exactly as a saved Infisical credential's
 * instance URL is, so inline and saved connections reach the same host and an
 * unusable URL is refused rather than retargeting the bearer token.
 */
export function infisicalApiUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl?.trim()) return `${INFISICAL_US_CLOUD_URL}${path}`
  try {
    return `${normalizeHttpBaseUrl(baseUrl)}${path}`
  } catch (error) {
    throw new Error(`Invalid Infisical instance URL: ${getErrorMessage(error)}`)
  }
}

/** The `/api/v4/secrets/{secretName}` path, refusing a dot-segment name that would retarget the request. */
export function infisicalSecretPath(secretName: string): string {
  return `/api/v4/secrets/${safeUrlPathSegment(secretName, 'secretName', { allowSeparators: true })}`
}

/**
 * The secret change request Infisical returns instead of `secret` when the
 * environment has a secret approval policy, so the write is pending review.
 */
export function mapInfisicalApproval(
  data: Record<string, unknown>
): InfisicalSecretApproval | null {
  const approval = data.approval
  if (!isRecordLike(approval)) return null
  return {
    id: toStringOrNull(approval.id),
    policyId: toStringOrNull(approval.policyId),
    slug: toStringOrNull(approval.slug),
    status: toStringOrNull(approval.status),
    hasMerged: toBooleanOrNull(approval.hasMerged),
    folderId: toStringOrNull(approval.folderId),
    createdAt: toStringOrNull(approval.createdAt),
    updatedAt: toStringOrNull(approval.updatedAt),
  }
}

/** Output schema for the pending change request a write returns under a secret approval policy. */
export const INFISICAL_APPROVAL_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Pending secret change request, returned instead of the secret when the environment has a secret approval policy',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Change request ID', nullable: true },
    policyId: { type: 'string', description: 'Approval policy ID', nullable: true },
    slug: { type: 'string', description: 'Change request slug', nullable: true },
    status: { type: 'string', description: 'Change request status (e.g., open)', optional: true },
    hasMerged: {
      type: 'boolean',
      description: 'Whether the change has been merged',
      optional: true,
    },
    folderId: { type: 'string', description: 'Folder ID the change applies to', nullable: true },
    createdAt: { type: 'string', description: 'Creation timestamp', nullable: true },
    updatedAt: { type: 'string', description: 'Last update timestamp', nullable: true },
  },
}
