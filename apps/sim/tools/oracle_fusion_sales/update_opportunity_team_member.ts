import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesUpdateOpportunityTeamMemberParams,
  TEAM_MEMBER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateOpportunityTeamMemberTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateOpportunityTeamMemberParams>({
    id: 'oracle_fusion_sales_update_opportunity_team_member',
    operation: 'update_opportunity_team_member',
    name: 'Oracle Fusion Sales Update opportunity team member',
    description:
      'Update opportunity team member in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: TEAM_MEMBER_OUTPUT_PROPERTIES,
      },
    },
  })
