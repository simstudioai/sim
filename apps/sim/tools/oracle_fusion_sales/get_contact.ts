import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesGetContactParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesGetContactTool =
  createOracleFusionSalesTool<OracleFusionSalesGetContactParams>({
    id: 'oracle_fusion_sales_get_contact',
    operation: 'get_contact',
    name: 'Oracle Fusion Sales Get contact',
    description: 'Get contact in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: CONTACT_OUTPUT_PROPERTIES,
      },
    },
  })
