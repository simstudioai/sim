/**
 * Search utility functions for tiered matching algorithm
 * Provides predictable search results prioritizing exact matches over fuzzy matches
 */

export interface SearchableItem {
  id: string
  name: string
  description?: string
  type: string
  [key: string]: any
}

export interface SearchResult<T extends SearchableItem> {
  item: T
  score: number
  matchType: 'exact' | 'prefix' | 'word-boundary' | 'substring' | 'description'
}

const SCORE_EXACT_MATCH = 10000
const SCORE_PREFIX_MATCH = 5000
const SCORE_WORD_BOUNDARY = 1000
const SCORE_SUBSTRING_MATCH = 100
const DESCRIPTION_WEIGHT = 0.3

/**
 * Calculate match score for a single field
 * Returns 0 if no match found
 */
function calculateFieldScore(
  query: string,
  field: string
): {
  score: number
  matchType: 'exact' | 'prefix' | 'word-boundary' | 'substring' | null
} {
  const normalizedQuery = query.toLowerCase().trim()
  const normalizedField = field.toLowerCase().trim()

  if (!normalizedQuery || !normalizedField) {
    return { score: 0, matchType: null }
  }

  // Tier 1: Exact match
  if (normalizedField === normalizedQuery) {
    return { score: SCORE_EXACT_MATCH, matchType: 'exact' }
  }

  // Tier 2: Prefix match (starts with query)
  if (normalizedField.startsWith(normalizedQuery)) {
    return { score: SCORE_PREFIX_MATCH, matchType: 'prefix' }
  }

  // Tier 3: Word boundary match (query matches start of a word)
  const words = normalizedField.split(/[\s-_/]+/)
  const hasWordBoundaryMatch = words.some((word) => word.startsWith(normalizedQuery))
  if (hasWordBoundaryMatch) {
    return { score: SCORE_WORD_BOUNDARY, matchType: 'word-boundary' }
  }

  // Tier 4: Substring match (query appears anywhere)
  if (normalizedField.includes(normalizedQuery)) {
    return { score: SCORE_SUBSTRING_MATCH, matchType: 'substring' }
  }

  // No match
  return { score: 0, matchType: null }
}

/**
 * Search items using tiered matching algorithm
 * Returns items sorted by relevance (highest score first)
 */
export function searchItems<T extends SearchableItem>(
  query: string,
  items: T[]
): SearchResult<T>[] {
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return []
  }

  const results: SearchResult<T>[] = []

  for (const item of items) {
    const nameMatch = calculateFieldScore(normalizedQuery, item.name)

    const descMatch = item.description
      ? calculateFieldScore(normalizedQuery, item.description)
      : { score: 0, matchType: null }

    const nameScore = nameMatch.score
    const descScore = descMatch.score * DESCRIPTION_WEIGHT

    const bestScore = Math.max(nameScore, descScore)

    if (bestScore > 0) {
      let matchType: SearchResult<T>['matchType'] = 'substring'
      if (nameScore >= descScore) {
        matchType = nameMatch.matchType || 'substring'
      } else {
        matchType = 'description'
      }

      results.push({
        item,
        score: bestScore,
        matchType,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)

  return results
}

/**
 * Get a human-readable match type label
 */
export function getMatchTypeLabel(matchType: SearchResult<any>['matchType']): string {
  switch (matchType) {
    case 'exact':
      return 'Exact match'
    case 'prefix':
      return 'Starts with'
    case 'word-boundary':
      return 'Word match'
    case 'substring':
      return 'Contains'
    case 'description':
      return 'In description'
    default:
      return 'Match'
  }
}
