import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  PROCESS_ACTION_ITEM_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListProcessActionItemsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_process_action_items',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of process action item records',
      items: { type: 'object', properties: PROCESS_ACTION_ITEM_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
