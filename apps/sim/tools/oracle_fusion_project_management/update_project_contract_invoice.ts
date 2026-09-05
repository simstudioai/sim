import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionUpdateProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionInvoiceOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-patch.html
export const oracleFusionProjectManagementUpdateProjectContractInvoiceTool: InternalToolConfig<
  OracleFusionUpdateProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_update_project_contract_invoice',
  name: 'Oracle Fusion Project Management Update Project Contract Invoice',
  description: "Update project contract invoice in Oracle Fusion Cloud Project Management.",
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
    invoiceComment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "invoice Comment (null is accepted by the documented API)",
    },
    invoiceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "invoice Date (null is accepted by the documented API)",
    },
    invoiceInstructions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "invoice Instructions (null is accepted by the documented API)",
    },
    unreleaseComments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "unrelease Comments (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoice: { type: 'json', description: 'Documented invoice fields', properties: oracleFusionInvoiceOutput },
  },
}
