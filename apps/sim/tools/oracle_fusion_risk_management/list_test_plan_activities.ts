import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  TEST_PLAN_ACTIVITY_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListTestPlanActivitiesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_test_plan_activities',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of test plan activity records',
      items: { type: 'object', properties: TEST_PLAN_ACTIVITY_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
