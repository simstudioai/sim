type Logger = {
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  debug?: (message: string, meta?: Record<string, unknown>) => void
}

export interface ParsedGaqlResponse {
  gaqlQuery: string
  queryType?: string
  periodType?: string
  startDate?: string
  endDate?: string
  isComparison: boolean
  comparisonQuery?: string
  comparisonStartDate?: string
  comparisonEndDate?: string
}

export function parseAiResponse(
  aiResponse: unknown,
  userInput: string,
  logger: Logger
): ParsedGaqlResponse {
  const aiContent = extractAiContent(aiResponse)

  logger.info('===== AI RAW RESPONSE =====', {
    userInput,
    aiContent,
    aiContentLength: aiContent.length,
  })

  if (
    aiContent.includes('"error"') &&
    !aiContent.includes('"gaql_query"') &&
    !aiContent.includes('"query"')
  ) {
    logger.error('AI returned error instead of GAQL query', { aiContent })
    throw new Error(`AI refused to generate query: ${aiContent}`)
  }

  const cleanedContent = aiContent.replace(/```json\n?|\n?```/g, '').trim()
  const parsedResponse = parseJsonResponse(cleanedContent, logger)
  const gaqlQuery = extractGaqlQuery(parsedResponse, logger)

  const cleanedGaqlQuery = cleanGaqlQuery(gaqlQuery, logger)
  validateGaqlQuery(cleanedGaqlQuery, logger)

  logger.info('AI generated GAQL successfully', {
    query_type: parsedResponse.query_type,
    period_type: parsedResponse.period_type,
    start_date: parsedResponse.start_date,
    end_date: parsedResponse.end_date,
    original_gaql: gaqlQuery,
    cleaned_gaql: cleanedGaqlQuery,
  })

  return {
    gaqlQuery: cleanedGaqlQuery,
    queryType: parsedResponse.query_type,
    periodType: parsedResponse.period_type,
    startDate: parsedResponse.start_date,
    endDate: parsedResponse.end_date,
    isComparison: parsedResponse.is_comparison || false,
    comparisonQuery: parsedResponse.comparison_query
      ? fixSegmentsDateInQuery(parsedResponse.comparison_query)
      : undefined,
    comparisonStartDate: parsedResponse.comparison_start_date,
    comparisonEndDate: parsedResponse.comparison_end_date,
  }
}

function extractAiContent(aiResponse: unknown): string {
  if (typeof aiResponse === 'string') {
    return aiResponse
  }

  if (!aiResponse || typeof aiResponse !== 'object') {
    return ''
  }

  const candidate = aiResponse as Record<string, unknown>

  if (typeof candidate.content === 'string') {
    return candidate.content
  }

  if (
    candidate.output &&
    typeof candidate.output === 'object' &&
    candidate.output !== null &&
    typeof (candidate.output as Record<string, unknown>).content === 'string'
  ) {
    return (candidate.output as Record<string, unknown>).content as string
  }

  return ''
}

function parseJsonResponse(cleanedContent: string, logger: Logger): any {
  try {
    return JSON.parse(cleanedContent)
  } catch (error) {
    logger.warn('Failed to parse AI response as single JSON', {
      preview: `${cleanedContent.substring(0, 200)}...`,
      error,
    })

    const firstObjectMatch = cleanedContent.match(/\{[\s\S]*\}/)
    if (firstObjectMatch) {
      try {
        return JSON.parse(firstObjectMatch[0])
      } catch (nestedError) {
        logger.warn('Failed to parse first JSON object extracted from AI response', {
          preview: `${firstObjectMatch[0].substring(0, 200)}...`,
          error: nestedError,
        })
      }
    }

    throw new Error(`AI response missing GAQL query: ${cleanedContent.substring(0, 200)}...`)
  }
}

function extractGaqlQuery(parsedResponse: any, logger: Logger): string {
  let gaqlQuery = parsedResponse?.gaql_query || parsedResponse?.query || undefined

  if (!gaqlQuery && Array.isArray(parsedResponse) && parsedResponse.length > 0) {
    gaqlQuery = parsedResponse[0]?.query || parsedResponse[0]?.gaql_query || undefined
    logger.info('AI returned array of queries (multi-level), using first query', {
      totalQueries: parsedResponse.length,
      levels: parsedResponse.map((q: any) => q?.level),
      selectedQuery: gaqlQuery,
    })
  }

  if (
    !gaqlQuery &&
    parsedResponse?.queries &&
    Array.isArray(parsedResponse.queries) &&
    parsedResponse.queries.length > 0
  ) {
    gaqlQuery =
      parsedResponse.queries[0]?.query || parsedResponse.queries[0]?.gaql_query || undefined
    logger.info('Using first query from queries array', {
      totalQueries: parsedResponse.queries.length,
      selectedQuery: gaqlQuery,
    })
  }

  if (!gaqlQuery) {
    logger.error('AI response missing GAQL query field', { parsedResponse })
    throw new Error(`AI response missing GAQL query: ${JSON.stringify(parsedResponse)}`)
  }

  if (typeof gaqlQuery !== 'string') {
    logger.error('GAQL query is not a string', {
      gaqlQuery,
      type: typeof gaqlQuery,
    })
    throw new Error(
      `AI returned invalid GAQL query type: ${typeof gaqlQuery}. Expected string, got: ${JSON.stringify(
        gaqlQuery
      )}`
    )
  }

  return gaqlQuery
}

function cleanGaqlQuery(gaqlQuery: string, logger: Logger): string {
  let cleaned = gaqlQuery
    .replace(/```sql\n?|\n?```/g, '')
    .replace(/```gaql\n?|\n?```/g, '')
    .replace(/```\n?|\n?```/g, '')
    .trim()

  const before = cleaned
  cleaned = cleaned.replace(/\s+GROUP\s+BY\s+[^ORDER\s]+/gi, '')

  if (before !== cleaned && logger.debug) {
    logger.debug('Removed unsupported GROUP BY clause from GAQL query', {
      original: before,
      cleaned,
    })
  }

  return cleaned
}

function validateGaqlQuery(gaqlQuery: string, logger: Logger): void {
  const queryWithoutValidParens = gaqlQuery
    .replace(/BETWEEN '[^']*' AND '[^']*'/g, '')
    .replace(/IN\s*\([^)]+\)/gi, '')
    .replace(/[<>]=?/g, '')

  const hasInvalidChars = /[(){}[\]]/.test(queryWithoutValidParens)
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(gaqlQuery)
  const hasOrOperator = /\bOR\b/i.test(gaqlQuery)
  const hasSelect = gaqlQuery.toUpperCase().includes('SELECT')

  if (hasInvalidChars || hasGroupBy || hasOrOperator || !hasSelect) {
    logger.error('AI generated invalid GAQL query', {
      cleanedQuery: gaqlQuery,
      hasInvalidChars,
      hasGroupBy,
      hasOrOperator,
      hasSelect,
    })
    throw new Error(
      `AI generated invalid GAQL query: ${gaqlQuery}. GAQL does not support OR operators. For comparisons, use isComparison: true with separate queries.`
    )
  }
}

function fixSegmentsDateInQuery(query: string): string {
  return query.trim()
}
