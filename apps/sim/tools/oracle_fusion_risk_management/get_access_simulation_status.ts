import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'

export const oracleFusionRiskManagementGetAccessSimulationStatusTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_access_simulation_status',
  outputs: {
    status: {
      type: 'string',
      description: 'Oracle simulation status: Started, Completed, Failed, or Queued',
    },
  },
})
