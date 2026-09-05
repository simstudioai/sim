import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_TEST_PLAN_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateControlTestPlanTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_control_test_plan',
  outputs: {
    record: {
      type: 'object',
      description: 'control test plan fields',
      properties: CONTROL_TEST_PLAN_OUTPUT_PROPERTIES,
    },
  },
})
