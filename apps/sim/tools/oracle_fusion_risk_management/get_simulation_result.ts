import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { SIMULATION_RESULT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetSimulationResultTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_simulation_result',
  outputs: {
    record: {
      type: 'object',
      description: 'simulation result fields',
      properties: SIMULATION_RESULT_OUTPUT_PROPERTIES,
    },
  },
})
