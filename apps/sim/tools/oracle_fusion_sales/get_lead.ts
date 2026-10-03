import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  LEAD_OUTPUT_PROPERTIES,
  type OracleFusionSalesGetLeadParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesGetLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesGetLeadParams>({
    id: 'oracle_fusion_sales_get_lead',
    operation: 'get_lead',
    name: 'Oracle Fusion Sales Get lead',
    description: 'Get lead in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: LEAD_OUTPUT_PROPERTIES,
      },
    },
  })
