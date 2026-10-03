import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_ACTION_ITEM_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetProcessActionItemTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_process_action_item',
  outputs: {
    record: {
      type: 'object',
      description: 'process action item fields',
      properties: PROCESS_ACTION_ITEM_OUTPUT_PROPERTIES,
    },
  },
})
