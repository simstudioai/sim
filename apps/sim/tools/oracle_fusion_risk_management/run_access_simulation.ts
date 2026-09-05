import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'

export const oracleFusionRiskManagementRunAccessSimulationTool = createRiskTool({
  id: 'oracle_fusion_risk_management_run_access_simulation',
  outputs: {
    requestId: {
      type: 'string',
      description: 'Simulation tracking ID; submission does not mean analysis is complete or access was granted',
    },
  },
})
