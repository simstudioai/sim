import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  GET_OFFER_OUTPUTS,
  type OracleFusionRecruitingGetOfferParams,
  type OracleFusionRecruitingGetOfferResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingGetOfferTool: InternalToolConfig<
  OracleFusionRecruitingGetOfferParams,
  OracleFusionRecruitingGetOfferResponse
> = {
  id: 'oracle_fusion_recruiting_get_offer',
  name: 'Get Offer',
  description: 'Get offer.',
  ...internalExecution,
  params: {
    ...credentials,
    offerId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Offer id; use the identifier returned by the matching list tool' },
  },
  outputs: GET_OFFER_OUTPUTS,
}
