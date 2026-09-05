import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesListSalesResourcesParams,
  PAGINATION_OUTPUTS,
  RESOURCE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListSalesResourcesTool =
  createOracleFusionSalesTool<OracleFusionSalesListSalesResourcesParams>({
    id: 'oracle_fusion_sales_list_sales_resources',
    operation: 'list_sales_resources',
    name: 'Oracle Fusion Sales List sales resources',
    description:
      'List one bounded page of sales resources from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: RESOURCE_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
