import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  LEAD_OUTPUT_PROPERTIES,
  type OracleFusionSalesListLeadsParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListLeadsTool =
  createOracleFusionSalesTool<OracleFusionSalesListLeadsParams>({
    id: 'oracle_fusion_sales_list_leads',
    operation: 'list_leads',
    name: 'Oracle Fusion Sales List leads',
    description:
      'List one bounded page of leads from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: LEAD_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
