import { accountInformationTool } from '@/tools/prospeo/account_information'
import { bulkEnrichCompanyTool } from '@/tools/prospeo/bulk_enrich_company'
import { bulkEnrichPersonTool } from '@/tools/prospeo/bulk_enrich_person'
import { enrichCompanyTool } from '@/tools/prospeo/enrich_company'
import { enrichPersonTool } from '@/tools/prospeo/enrich_person'
import { searchCompanyTool } from '@/tools/prospeo/search_company'
import { searchPersonTool } from '@/tools/prospeo/search_person'
import { searchSuggestionsTool } from '@/tools/prospeo/search_suggestions'

export const prospeoAccountInformationTool = accountInformationTool
export const prospeoEnrichPersonTool = enrichPersonTool
export const prospeoEnrichCompanyTool = enrichCompanyTool
export const prospeoBulkEnrichPersonTool = bulkEnrichPersonTool
export const prospeoBulkEnrichCompanyTool = bulkEnrichCompanyTool
export const prospeoSearchPersonTool = searchPersonTool
export const prospeoSearchCompanyTool = searchCompanyTool
export const prospeoSearchSuggestionsTool = searchSuggestionsTool
