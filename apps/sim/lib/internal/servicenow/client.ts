import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { ServiceNowOperationError } from '@/lib/internal/servicenow/errors'
import type { ServiceNowAttachment, ServiceNowAuthParams } from '@/tools/servicenow/types'
import { serviceNowAuthorization } from '@/tools/servicenow/utils'

export async function uploadServiceNowAttachment(
  input: Omit<ServiceNowAuthParams, 'username'> & {
    username?: string
    contentType: string
    fileName: string
    recordSysId: string
    tableName: string
  },
  buffer: Buffer,
  signal?: AbortSignal
): Promise<ServiceNowAttachment | null> {
  signal?.throwIfAborted()
  const baseUrl = input.instanceUrl.trim().replace(/\/$/, '')
  const params = new URLSearchParams({
    table_name: input.tableName.trim(),
    table_sys_id: input.recordSysId.trim(),
    file_name: input.fileName,
  })
  const response = await secureFetchWithValidation(
    `${baseUrl}/api/now/attachment/file?${params.toString()}`,
    {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: {
        Authorization: serviceNowAuthorization(input),
        'Content-Type': input.contentType,
        Accept: 'application/json',
      },
      body: buffer,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'instanceUrl'
  )
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = isRecordLike(data) ? toRecordOrNull(data.error) : null
    const message =
      error && typeof error.message === 'string'
        ? error.message
        : `ServiceNow API error: ${response.status} ${response.statusText}`
    throw new ServiceNowOperationError(message, response.status)
  }
  if (!isRecordLike(data) || !isRecordLike(data.result)) return null
  return data.result as ServiceNowAttachment
}
