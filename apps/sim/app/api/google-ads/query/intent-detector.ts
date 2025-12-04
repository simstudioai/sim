import type { DateRange } from './date-utils'
import type { Intent, PromptContext } from './prompt-fragments'

const COMPARISON_KEYWORDS = [
  'compare',
  'comparison',
  'vs',
  'versus',
  'week over week',
  'wow',
  'previous week',
  'prior week',
  'last week',
  'and then',
] as const

const RSA_KEYWORDS = [
  'rsa',
  'responsive search ad',
  'ad strength',
  'headlines',
  'descriptions',
] as const

const EXTENSION_KEYWORDS = [
  'extension',
  'sitelink',
  'callout',
  'structured snippet',
  'asset extension',
] as const

const SEARCH_TERMS_KEYWORDS = ['search term', 'search query', 'sqr'] as const

const DEMOGRAPHIC_KEYWORDS = ['gender', 'age range', 'demographic'] as const

const GEOGRAPHIC_KEYWORDS = [
  'geo',
  'geographic',
  'country',
  'city',
  'region',
  'state',
  'location performance',
] as const

const LOCATION_TARGETING_KEYWORDS = [
  'location targeting',
  'targeting settings',
  'geo target',
  'geo targeting',
] as const

const BRAND_KEYWORDS = ['brand vs', 'non-brand', 'non brand', 'pmax', 'brand campaign'] as const

const AD_COPY_KEYWORDS = [
  'ad copy',
  'poor ad',
  'average ad',
  'improve ad',
  'optimize ad',
  'ad suggestion',
  'headline suggestion',
  'description suggestion',
  'keyword-aligned',
] as const

export interface DetectedIntents {
  intents: Intent[]
  promptContext: PromptContext
}

export function detectIntents(userInput: string, dateRanges: DateRange[]): DetectedIntents {
  const lower = userInput.toLowerCase()
  const intents = new Set<Intent>()
  const promptContext: PromptContext = {}

  const hasComparisonKeywords = COMPARISON_KEYWORDS.some((keyword) => lower.includes(keyword))

  if (dateRanges.length === 2 || hasComparisonKeywords) {
    intents.add('comparison')

    if (dateRanges.length === 2) {
      promptContext.comparison = {
        comparison: dateRanges[0],
        main: dateRanges[1],
      }
    }
  }

  if (RSA_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('rsa')
  }

  if (EXTENSION_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('extensions')
  }

  if (SEARCH_TERMS_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('search_terms')
  }

  if (DEMOGRAPHIC_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('demographics')
  }

  if (GEOGRAPHIC_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('geographic')
  }

  if (LOCATION_TARGETING_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('location_targeting')
  }

  if (BRAND_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('brand_vs_nonbrand')
  }

  if (AD_COPY_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    intents.add('ad_copy_optimization')
  }

  return {
    intents: Array.from(intents),
    promptContext,
  }
}
