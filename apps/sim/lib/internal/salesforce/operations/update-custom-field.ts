import { createLogger } from '@sim/logger'
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
> = async (params): Promise<SalesforceUpdateCustomFieldResponse> => {
  const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
  const fieldId = requireId(params.fieldId, 'Field ID')
  const url = `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomField/${fieldId}`
  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
  }

  const readResponse = await fetch(url, { headers })
  const existing = await readResponse.json().catch(() => ({}))
  if (!readResponse.ok) {
    const errorMessage = extractErrorMessage(
      existing,
      readResponse.status,
      'Failed to load custom field for update'
    )
    logger.error('Failed to read custom field metadata', { status: readResponse.status })
    throw new Error(errorMessage)
  }

  const metadata = mergeCustomFieldMetadata(existing?.Metadata, params)

  const patchResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ Metadata: metadata }),
  })
  if (!patchResponse.ok) {
    const errorData = await patchResponse.json().catch(() => ({}))
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
