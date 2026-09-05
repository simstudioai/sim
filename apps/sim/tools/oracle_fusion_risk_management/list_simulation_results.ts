import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  SIMULATION_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListSimulationResultsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_simulation_results',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of simulation result records',
      items: { type: 'object', properties: SIMULATION_RESULT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
