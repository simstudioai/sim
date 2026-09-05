import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_AGENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetProcurementAgentTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_procurement_agent',
  name: 'Oracle Fusion Procurement Get Procurement Agent',
  description:
    'Get Procurement Agent in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    assignmentId: procurementParamFields.assignmentId,
  },
  outputs: {
    procurementAgent: {
      type: 'object',
      description: 'Procurement Agent fields',
      properties: PROCUREMENT_AGENT_OUTPUT_PROPERTIES,
    },
  },
})
