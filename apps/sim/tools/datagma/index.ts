export * from './types'

import { enrichCompanyTool } from '@/tools/datagma/enrich_company'
import { enrichPersonTool } from '@/tools/datagma/enrich_person'
import { findEmailTool } from '@/tools/datagma/find_email'
import { findPhoneTool } from '@/tools/datagma/find_phone'
import { getCreditsTool } from '@/tools/datagma/get_credits'

export const datagmaEnrichCompanyTool = enrichCompanyTool
export const datagmaEnrichPersonTool = enrichPersonTool
export const datagmaFindEmailTool = findEmailTool
export const datagmaFindPhoneTool = findPhoneTool
export const datagmaGetCreditsTool = getCreditsTool
