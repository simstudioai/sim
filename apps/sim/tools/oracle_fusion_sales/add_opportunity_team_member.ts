import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesAddOpportunityTeamMemberParams,
  TEAM_MEMBER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAddOpportunityTeamMemberTool =
  createOracleFusionSalesTool<OracleFusionSalesAddOpportunityTeamMemberParams>({
    id: 'oracle_fusion_sales_add_opportunity_team_member',
    operation: 'add_opportunity_team_member',
    name: 'Oracle Fusion Sales Add opportunity team member',
    description:
      'Add opportunity team member in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: TEAM_MEMBER_OUTPUT_PROPERTIES,
      },
    },
  })
