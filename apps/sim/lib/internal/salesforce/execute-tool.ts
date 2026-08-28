import { executeSalesforceUpdateCustomFieldOperation } from '@/lib/internal/salesforce/operations/update-custom-field'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeSalesforceTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'salesforce_update_custom_field':
      return executeToolOperationImplementation(
        executeSalesforceUpdateCustomFieldOperation,
        request
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported salesforce tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
