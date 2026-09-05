import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateAppointmentParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateAppointmentTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateAppointmentParams>({
    id: 'oracle_fusion_sales_create_appointment',
    operation: 'create_appointment',
    name: 'Oracle Fusion Sales Create appointment',
    description: 'Create appointment in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACTIVITY_OUTPUT_PROPERTIES,
      },
    },
  })
