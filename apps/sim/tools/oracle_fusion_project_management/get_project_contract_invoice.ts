import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionInvoiceOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-get.html
export const oracleFusionProjectManagementGetProjectContractInvoiceTool: InternalToolConfig<
  OracleFusionGetProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_project_contract_invoice',
  name: 'Oracle Fusion Project Management Get Project Contract Invoice',
  description: 'Get project contract invoice in Oracle Fusion Cloud Project Management.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    invoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice ID as a decimal string',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoice: {
      type: 'json',
      description: 'Documented invoice fields',
      properties: oracleFusionInvoiceOutput,
    },
  },
}
