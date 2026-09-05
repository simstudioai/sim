import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionTransitionProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-action-releaseprojectcontractinvoice-post.html
export const oracleFusionProjectManagementTransitionProjectContractInvoiceTool: InternalToolConfig<
  OracleFusionTransitionProjectContractInvoiceParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_transition_project_contract_invoice',
  name: 'Oracle Fusion Project Management Transition Project Contract Invoice',
  description: "Invoke one fixed, documented project-contract invoice lifecycle action. Release-only fields and unrelease comments apply only to their corresponding action; no automatic transition chaining.",
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
    receivablesNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "receivables Number (null is accepted by the documented API)",
    },
    creditMemoReasonCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "credit Memo Reason Code (null is accepted by the documented API)",
    },
    invoiceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "invoice Date (null is accepted by the documented API)",
    },
    creditMemoReasonMeaning: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "credit Memo Reason Meaning (null is accepted by the documented API)",
    },
    unreleaseComments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "unrelease Comments (null is accepted by the documented API)",
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Exactly one of submit, approve, reject, release, return_to_draft, unrelease, cancel; Oracle enforces the current invoice status",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    result: { type: 'string', description: 'Documented Oracle action result; not a refreshed resource' },
  },
}
