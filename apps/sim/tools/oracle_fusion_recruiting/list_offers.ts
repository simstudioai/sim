import {
  credentials,
  internalExecution,
  page,
  search,
} from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_OFFERS_OUTPUTS,
  type OracleFusionRecruitingListOffersParams,
  type OracleFusionRecruitingListOffersResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListOffersTool: InternalToolConfig<
  OracleFusionRecruitingListOffersParams,
  OracleFusionRecruitingListOffersResponse
> = {
  id: 'oracle_fusion_recruiting_list_offers',
  name: 'List Offers',
  description: 'List offers.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
    requisitionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by requisition ID as a positive decimal string',
    },
  },
  outputs: LIST_OFFERS_OUTPUTS,
}
