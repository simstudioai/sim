import type { OciMonitoringResponse } from '@/tools/oci_monitoring/types'

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
} as const

/** Preserve the internal operation's partial-failure output and retry classification. */
export async function transformOciMonitoringResponse(
  response: Response
): Promise<OciMonitoringResponse> {
  const result: OciMonitoringResponse = await response.json()
  if (!response.ok && result.success !== false) {
    return { success: false, error: 'OCI Monitoring request failed', output: {} }
  }
  return result
}
