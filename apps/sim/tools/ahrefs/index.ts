import { backlinksTool } from '@/tools/ahrefs/backlinks'
import { backlinksStatsTool } from '@/tools/ahrefs/backlinks_stats'
import { brokenBacklinksTool } from '@/tools/ahrefs/broken_backlinks'
import { domainRatingTool } from '@/tools/ahrefs/domain_rating'
import { keywordOverviewTool } from '@/tools/ahrefs/keyword_overview'
import { organicKeywordsTool } from '@/tools/ahrefs/organic_keywords'
import { referringDomainsTool } from '@/tools/ahrefs/referring_domains'
import { topPagesTool } from '@/tools/ahrefs/top_pages'

export const ahrefsDomainRatingTool = domainRatingTool
export const ahrefsBacklinksTool = backlinksTool
export const ahrefsBacklinksStatsTool = backlinksStatsTool
export const ahrefsReferringDomainsTool = referringDomainsTool
export const ahrefsOrganicKeywordsTool = organicKeywordsTool
export const ahrefsTopPagesTool = topPagesTool
export const ahrefsKeywordOverviewTool = keywordOverviewTool
export const ahrefsBrokenBacklinksTool = brokenBacklinksTool
