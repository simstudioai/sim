import type { OciEventsResponse } from '@/tools/oci_events/types'

export const OCI_CONNECTION_PARAMS = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable OCI API signing-key credential.',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'OCI region override; omit to use the credential region.',
  },
  opcRequestId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional request identifier for OCI support correlation.',
  },
} as const

/** Preserve the internal handler response, including its mutation retry classification. */
export async function transformOciEventsResponse(response: Response): Promise<OciEventsResponse> {
  const result: OciEventsResponse = await response.json()
  if (!response.ok && result.success !== false) {
    return { success: false, retryable: false, error: 'OCI Events request failed', output: {} }
  }
  return result
}
