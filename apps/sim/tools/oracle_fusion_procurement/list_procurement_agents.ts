import {
  createProcurementTool,
  procurementListParams,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_AGENT_OUTPUT_PROPERTIES,
  PROCUREMENT_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListProcurementAgentsTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_procurement_agents',
  name: 'Oracle Fusion Procurement List Procurement Agents',
  description:
    'List Procurement Agents in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of procurement Agents',
      items: { type: 'object', properties: PROCUREMENT_AGENT_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
