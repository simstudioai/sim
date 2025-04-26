// /sim/tools/hubspot/index.ts
import { listContactsTool } from './listContacts'
import { createContactTool } from './createContact'
import { searchContactsTool } from './searchContacts'
import { listDealsTool } from './listDeals'
import { createDealTool } from './createDeal'
import { searchDealsTool } from './searchDeals'
import { listCampaignsTool } from './listCampaigns'
import { listFormsTool } from './listForms'

export const hubspotListContactsTool = listContactsTool
export const hubspotCreateContactTool = createContactTool
export const hubspotSearchContactsTool = searchContactsTool
export const hubspotListDealsTool = listDealsTool
export const hubspotCreateDealTool = createDealTool
export const hubspotSearchDealsTool = searchDealsTool
export const hubspotListCampaignsTool = listCampaignsTool
export const hubspotListFormsTool = listFormsTool
