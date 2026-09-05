import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'

export const oracleFusionRiskManagementDeleteControlTestPlanTool = createRiskTool({
  id: 'oracle_fusion_risk_management_delete_control_test_plan',
  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Oracle acknowledged deletion of the selected record or association',
    },
  },
})
