import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type {
  SalesforceUpdateCustomFieldParams,
  SalesforceUpdateCustomFieldResponse,
} from '@/tools/salesforce/types'
import {
  extractErrorMessage,
  getInstanceUrl,
  mergeCustomFieldMetadata,
  requireId,
} from '@/tools/salesforce/utils'

const logger = createLogger('SalesforceUpdateCustomField')

export const executeSalesforceUpdateCustomFieldOperation: InternalToolOperationImplementation<
  SalesforceUpdateCustomFieldParams
> = async (params, signal): Promise<SalesforceUpdateCustomFieldResponse> => {
  const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
  const fieldId = requireId(params.fieldId, 'Field ID')
  const url = `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomField/${fieldId}`
  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
  }

  const readResponse = await fetch(url, { headers, signal })
  let existing: unknown
  try {
    existing = await readResponse.json()
  } catch {
    signal?.throwIfAborted()
    if (readResponse.ok) {
      throw new Error('Salesforce returned malformed JSON while loading custom field metadata')
    }
    existing = {}
  }
  if (!readResponse.ok) {
    const errorMessage = extractErrorMessage(
      existing,
      readResponse.status,
      'Failed to load custom field for update'
    )
    logger.error('Failed to read custom field metadata', { status: readResponse.status })
    throw new Error(errorMessage)
  }
  signal?.throwIfAborted()
  if (!isRecordLike(existing) || !isRecordLike(existing.Metadata)) {
    throw new Error('Salesforce returned no custom field metadata to update')
  }

  const metadata = mergeCustomFieldMetadata(existing.Metadata, params)

  const patchResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ Metadata: metadata }),
    signal,
  })
  if (!patchResponse.ok) {
    const errorData = await patchResponse.json().catch(() => {
      signal?.throwIfAborted()
      return {}
    })
    const errorMessage = extractErrorMessage(
      errorData,
      patchResponse.status,
      'Failed to update custom field in Salesforce'
    )
    logger.error('Failed to update custom field', { status: patchResponse.status })
    throw new Error(errorMessage)
  }

  return {
    success: true,
    output: {
      id: fieldId,
      updated: true,
    },
  }
}
