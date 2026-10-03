import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'

export const oracleFusionRiskManagementDeleteTestPlanStepTool = createRiskTool({
  id: 'oracle_fusion_risk_management_delete_test_plan_step',
  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Oracle acknowledged deletion of the selected record or association',
    },
  },
})
