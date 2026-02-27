import { createApplicationTool } from '@/tools/ashby/create_application'
import { createCandidateTool } from '@/tools/ashby/create_candidate'
import { createNoteTool } from '@/tools/ashby/create_note'
import { getApplicationTool } from '@/tools/ashby/get_application'
import { getCandidateTool } from '@/tools/ashby/get_candidate'
import { getJobTool } from '@/tools/ashby/get_job'
import { listApplicationsTool } from '@/tools/ashby/list_applications'
import { listCandidatesTool } from '@/tools/ashby/list_candidates'
import { listJobsTool } from '@/tools/ashby/list_jobs'
import { listNotesTool } from '@/tools/ashby/list_notes'
import { listOffersTool } from '@/tools/ashby/list_offers'
import { searchCandidatesTool } from '@/tools/ashby/search_candidates'
import { updateCandidateTool } from '@/tools/ashby/update_candidate'

export const ashbyCreateApplicationTool = createApplicationTool
export const ashbyCreateCandidateTool = createCandidateTool
export const ashbyCreateNoteTool = createNoteTool
export const ashbyGetApplicationTool = getApplicationTool
export const ashbyGetCandidateTool = getCandidateTool
export const ashbyGetJobTool = getJobTool
export const ashbyListApplicationsTool = listApplicationsTool
export const ashbyListCandidatesTool = listCandidatesTool
export const ashbyListJobsTool = listJobsTool
export const ashbyListNotesTool = listNotesTool
export const ashbyListOffersTool = listOffersTool
export const ashbySearchCandidatesTool = searchCandidatesTool
export const ashbyUpdateCandidateTool = updateCandidateTool
