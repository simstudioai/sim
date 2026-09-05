import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesGetSalesResourceParams,
  RESOURCE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesGetSalesResourceTool =
  createOracleFusionSalesTool<OracleFusionSalesGetSalesResourceParams>({
    id: 'oracle_fusion_sales_get_sales_resource',
    operation: 'get_sales_resource',
    name: 'Oracle Fusion Sales Get sales resource',
    description: 'Get sales resource in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: RESOURCE_OUTPUT_PROPERTIES,
      },
    },
  })
