import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesListOpportunitiesParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListOpportunitiesTool =
  createOracleFusionSalesTool<OracleFusionSalesListOpportunitiesParams>({
    id: 'oracle_fusion_sales_list_opportunities',
    operation: 'list_opportunities',
    name: 'Oracle Fusion Sales List opportunities',
    description:
      'List one bounded page of opportunities from Oracle Fusion Sales. Use q, finder, and pagination to control the result. Oracle defaults may restrict results to open opportunities owned by the current user and the configured close period; use MyOpportunitiesFinder to change that scope.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: OPPORTUNITY_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
