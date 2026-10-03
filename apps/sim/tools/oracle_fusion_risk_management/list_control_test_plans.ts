import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_TEST_PLAN_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlTestPlansTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_control_test_plans',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control test plan records',
      items: { type: 'object', properties: CONTROL_TEST_PLAN_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
