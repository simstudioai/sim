import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionUpdateProjectCostParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionCostOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-projectcostsuniqid-patch.html
export const oracleFusionProjectManagementUpdateProjectCostTool: InternalToolConfig<
  OracleFusionUpdateProjectCostParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_update_project_cost',
  name: 'Oracle Fusion Project Management Update Project Cost',
  description: "Update project-cost bill-rate metadata. Use Adjust Project Cost for billable/capitalizable flags, holds, transfers, or split adjustments.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    costKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Opaque project-cost key returned by list or get; not the numeric CostId",
    },
    externalBillRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "external Bill Rate (null is accepted by the documented API)",
    },
    externalBillRateCurrency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "external Bill Rate Currency (null is accepted by the documented API)",
    },
    externalBillRateSourceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "external Bill Rate Source Name (null is accepted by the documented API)",
    },
    externalBillRateSourceReference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "external Bill Rate Source Reference (null is accepted by the documented API)",
    },
    intercompanyBillRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "intercompany Bill Rate (null is accepted by the documented API)",
    },
    intercompanyBillRateCurrency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "intercompany Bill Rate Currency (null is accepted by the documented API)",
    },
    intercompanyBillRateSourceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "intercompany Bill Rate Source Name (null is accepted by the documented API)",
    },
    intercompanyBillRateSourceReference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "intercompany Bill Rate Source Reference (null is accepted by the documented API)",
    },
    payrollCostedCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "payroll Costed Code (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    cost: { type: 'json', description: 'Documented cost fields', properties: oracleFusionCostOutput },
  },
}
