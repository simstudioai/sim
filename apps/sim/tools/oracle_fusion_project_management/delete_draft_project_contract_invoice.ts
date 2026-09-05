import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionDeleteDraftProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-delete.html
export const oracleFusionProjectManagementDeleteDraftProjectContractInvoiceTool: InternalToolConfig<
  OracleFusionDeleteDraftProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_delete_draft_project_contract_invoice',
  name: 'Oracle Fusion Project Management Delete Draft Project Contract Invoice',
  description: "Delete a standard project contract invoice in draft status. Oracle rejects other invoice states; no preceding transition is performed.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    invoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "invoice ID as a decimal string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deleted: { type: 'boolean', description: 'True after Oracle accepts the deletion with an empty success response' },
    id: { type: 'string', description: 'Identifier supplied to this delete operation' },
  },
}
