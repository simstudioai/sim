import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateContactParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateContactTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateContactParams>({
    id: 'oracle_fusion_sales_create_contact',
    operation: 'create_contact',
    name: 'Oracle Fusion Sales Create contact',
    description:
      'Create contact in Oracle Fusion Sales using documented CRM REST fields. Provide at least firstName or lastName; address requirements depend on tenant configuration.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: CONTACT_OUTPUT_PROPERTIES,
      },
    },
  })
