import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  TEST_PLAN_STEP_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListTestPlanStepsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_test_plan_steps',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of test plan step records',
      items: { type: 'object', properties: TEST_PLAN_STEP_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
