// /sim/tools/hubspot/index.ts
import { listContactsTool } from './listContacts'
import { createContactTool } from './createContact'
import { updateContactTool } from './updateContact'
import { searchContactsTool } from './searchContacts'
import { listDealsTool } from './listDeals'
import { createDealTool } from './createDeal'
import { updateDealTool } from './updateDeal'
import { searchDealsTool } from './searchDeals'
import { listCampaignsTool } from './listCampaigns'
import { listFormsTool } from './listForms'
import { listEmailsTool } from './listEmails'

export const hubspotListContactsTool = listContactsTool
export const hubspotCreateContactTool = createContactTool
export const hubspotUpdateContactTool = updateContactTool
export const hubspotSearchContactsTool = searchContactsTool
export const hubspotListDealsTool = listDealsTool
export const hubspotCreateDealTool = createDealTool
export const hubspotUpdateDealTool = updateDealTool
export const hubspotSearchDealsTool = searchDealsTool
export const hubspotListCampaignsTool = listCampaignsTool
export const hubspotListFormsTool = listFormsTool
export const hubspotListEmailsTool = listEmailsTool