import { isRecordLike } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { ServiceNowOperationError } from '@/lib/internal/servicenow/errors'
import type { ServiceNowAttachment } from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'

export async function uploadServiceNowAttachment(
  input: {
    contentType: string
    fileName: string
    instanceUrl: string
    password: string
    recordSysId: string
    tableName: string
    username: string
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
      method: 'POST',
      headers: {
        Authorization: createBasicAuthHeader(input.username, input.password),
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
    const error = isRecordLike(data) && isRecordLike(data.error) ? data.error : null
    const message =
      error && typeof error.message === 'string'
        ? error.message
        : `ServiceNow API error: ${response.status} ${response.statusText}`
    throw new ServiceNowOperationError(message, response.status)
  }
  if (!isRecordLike(data) || !isRecordLike(data.result)) return null
  return data.result as ServiceNowAttachment
}
