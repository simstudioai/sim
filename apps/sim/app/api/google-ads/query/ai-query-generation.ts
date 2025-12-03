import { createLogger } from '@/lib/logs/console/logger'
import { executeProviderRequest } from '@/providers'
import { resolveProvider } from './ai-provider'
import { parseAiResponse } from './ai-response'
import { DEFAULT_DATE_RANGE_DAYS } from './constants'
import { containsDateMentions, extractDateRanges } from './date-extraction'
import { formatDate, getLastNDaysRange } from './date-utils'
import { detectIntents } from './intent-detector'
import { buildSystemPrompt } from './prompt-fragments'
import type { GaqlQueryResult } from './types'

const logger = createLogger('AIQueryGeneration')

/**
 * Generates a complete GAQL query using AI based on user input
 */
export async function generateSmartGAQL(
  userQuestion: string,
  accountName: string
): Promise<GaqlQueryResult> {
  logger.info('Generating complete GAQL query with AI', { userQuestion, accountName })

  try {
    // Use AI to generate complete GAQL query directly
    const aiResult = await generateGAQLWithAI(userQuestion)
    logger.info('AI GAQL generation successful', {
      queryType: aiResult.queryType,
      periodType: aiResult.periodType,
      startDate: aiResult.startDate,
      endDate: aiResult.endDate,
      gaqlLength: aiResult.gaqlQuery.length,
      isComparison: aiResult.isComparison,
    })

    return {
      gaqlQuery: aiResult.gaqlQuery,
      queryType: aiResult.queryType,
      periodType: aiResult.periodType,
      startDate: aiResult.startDate,
      endDate: aiResult.endDate,
      isComparison: aiResult.isComparison,
      comparisonQuery: aiResult.comparisonQuery,
      comparisonStartDate: aiResult.comparisonStartDate,
      comparisonEndDate: aiResult.comparisonEndDate,
    }
  } catch (error) {
    logger.error('AI GAQL generation failed', { error, userQuestion, accountName })

    // Preserve user-friendly error messages (date extraction, token limits)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isUserFriendlyError =
      errorMessage.includes('Unable to extract a date range') ||
      errorMessage.includes('date range in your query is too large')

    if (isUserFriendlyError) {
      // Re-throw the original helpful error message
      throw error
    }

    // For other errors, wrap with generic message
    throw new Error(`Failed to generate GAQL query: ${errorMessage}`)
  }
}

/**
 * Internal function that calls the AI provider to generate GAQL query
 */
async function generateGAQLWithAI(userInput: string): Promise<GaqlQueryResult> {
  logger.info('Generating complete GAQL query with AI', { userInput })

  // Step 1: Extract date ranges from user input
  const dateRanges = extractDateRanges(userInput)
  logger.info('Extracted date ranges from user input', {
    userInput,
    dateRangesFound: dateRanges.length,
    dateRanges,
  })

  // Step 1.5: Check if dates were mentioned but extraction failed
  const hasDateMentions = containsDateMentions(userInput)

  if (dateRanges.length === 0) {
    if (hasDateMentions) {
      // Dates were mentioned but extraction failed - throw error
      const errorMessage = `Unable to extract a date range from your query: "${userInput}"

Please try one of these formats:
• Relative periods: "today", "yesterday", "this week", "last week", "this month", "last month"
• Specific periods: "last 7 days", "last 30 days", "last 3 months"
• Date ranges: "January 2025", "Q1 2025", "2025-01-01 to 2025-01-31"
• Explicit dates: "9/1/2025 to 9/30/2025" or "Sept 1 to 30 2025"

Please re-run the agent with a clearer date specification.`

      logger.warn('Date extraction failed but dates were mentioned', { userInput, errorMessage })
      throw new Error(errorMessage)
    }

    // No dates mentioned - default to last 7 days
    logger.info('No date range mentioned in query, defaulting to last 7 days', { userInput })
    const defaultRange = getLastNDaysRange(DEFAULT_DATE_RANGE_DAYS)
    dateRanges.push(defaultRange) // Add default range so rest of function can proceed
  }

  // Step 2: Detect query intents and comparison context
  const { intents, promptContext } = detectIntents(userInput, dateRanges)

  // If we extracted a single date range (e.g., "this week"), add it to prompt context
  if (dateRanges.length === 1 && !promptContext.comparison) {
    promptContext.dateRange = dateRanges[0]
  }

  logger.info('Detected query intents', {
    intents,
    hasComparisonContext: !!promptContext.comparison,
    hasDateRange: !!promptContext.dateRange,
  })

  if (promptContext.comparison) {
    logger.info('Comparison mode activated', {
      mainPeriod: `${promptContext.comparison.main.start} to ${promptContext.comparison.main.end}`,
      comparisonPeriod: `${promptContext.comparison.comparison.start} to ${promptContext.comparison.comparison.end}`,
    })
  }

  const systemPrompt = buildSystemPrompt(intents, promptContext)
  const modifiedInput = userInput

  logger.debug('Constructed system prompt for GAQL generation', {
    promptLength: systemPrompt.length,
    intentsIncluded: intents,
  })

  const comparisonExample = promptContext.comparison
    ? `Example with detected ranges (${promptContext.comparison.comparison.start} to ${promptContext.comparison.comparison.end} vs ${promptContext.comparison.main.start} to ${promptContext.comparison.main.end}):
{
  "gaql_query": "SELECT ... WHERE segments.date BETWEEN '${promptContext.comparison.main.start}' AND '${promptContext.comparison.main.end}' ...",
  "comparison_query": "SELECT ... WHERE segments.date BETWEEN '${promptContext.comparison.comparison.start}' AND '${promptContext.comparison.comparison.end}' ...",
  "is_comparison": true,
  "start_date": "${promptContext.comparison.main.start}",
  "end_date": "${promptContext.comparison.main.end}",
  "comparison_start_date": "${promptContext.comparison.comparison.start}",
  "comparison_end_date": "${promptContext.comparison.comparison.end}"
}`
    : `Example for "Sept 8-14 and then 15-21":
{
  "gaql_query": "SELECT ... WHERE segments.date BETWEEN '2025-09-15' AND '2025-09-21' ...",
  "is_comparison": true,
  "comparison_query": "SELECT ... WHERE segments.date BETWEEN '2025-09-08' AND '2025-09-14' ...",
  "comparison_start_date": "2025-09-08",
  "comparison_end_date": "2025-09-14",
  "start_date": "2025-09-15",
  "end_date": "2025-09-21"
}`

  const responseInstructions = [
    'Respond with EXACTLY ONE valid JSON object. No additional text, no multiple JSON objects, no explanations.',
    'CRITICAL: If the user\'s question contains TWO date ranges or words like "and then", "compare", "vs", "previous week", you MUST:',
    '1. Set "is_comparison": true',
    '2. Provide "comparison_query" with the FIRST date range',
    '3. Provide "comparison_start_date" and "comparison_end_date" for the FIRST date range',
    '4. The main "gaql_query" should use the SECOND date range',
    comparisonExample,
  ].join('\n')

  const fullSystemPrompt = `${systemPrompt}\n\n${responseInstructions}`

  try {
    const { provider, model, apiKey } = resolveProvider(logger)

    logger.info('Making AI request for query parsing', {
      provider,
      model,
      hasApiKey: !!apiKey,
    })

    const aiResponse = await executeProviderRequest(provider, {
      model,
      systemPrompt: fullSystemPrompt,
      context: `Parse this Google Ads question: "${modifiedInput}"`,
      messages: [
        {
          role: 'user',
          content: `Parse this Google Ads question: "${modifiedInput}"`,
        },
      ],
      apiKey,
      temperature: 0.0, // Set to 0 for completely deterministic query generation
      maxTokens: provider === 'anthropic' ? 8192 : provider === 'xai' ? 16000 : 16000, // Claude: 8,192, Grok: 16,000, GPT-4o: 16,384
    })

    const parsed = parseAiResponse(aiResponse, userInput, logger)

    return {
      gaqlQuery: parsed.gaqlQuery,
      queryType: parsed.queryType || 'campaigns',
      periodType: parsed.periodType || 'last_30_days',
      startDate: parsed.startDate || formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      endDate: parsed.endDate || formatDate(new Date()),
      isComparison: parsed.isComparison || false,
      comparisonQuery: parsed.comparisonQuery,
      comparisonStartDate: parsed.comparisonStartDate,
      comparisonEndDate: parsed.comparisonEndDate,
    }
  } catch (error) {
    logger.error('AI query parsing failed', { error })

    // Check for token limit errors
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorLower = errorMessage.toLowerCase()

    // Common token limit error patterns across providers
    const isTokenLimitError =
      (errorLower.includes('token') &&
        (errorLower.includes('limit') || errorLower.includes('exceeded'))) ||
      errorLower.includes('context length') ||
      errorLower.includes('maximum context') ||
      errorLower.includes('too many tokens') ||
      errorLower.includes('input too long') ||
      errorMessage.includes('429') || // Rate limit (often related to token limits)
      (errorMessage.includes('400') && errorLower.includes('token'))

    if (isTokenLimitError) {
      const helpfulMessage = `The date range in your query is too large, causing the AI model to exceed token limits.

**Suggestions to fix this:**
• Reduce the date range: Try "last 30 days" instead of "last 90 days"
• Use shorter periods: "this month" instead of "last 6 months"
• Split large queries: Ask for specific months separately (e.g., "January 2025" then "February 2025")
• Avoid year-long queries: Instead of "2025", try "Q1 2025" or "last 3 months"

Please re-run the agent with a smaller date range.`

      logger.error('Token limit error detected', {
        originalError: errorMessage,
        userInput,
        helpfulMessage,
      })
      throw new Error(helpfulMessage)
    }

    // For other AI errors, throw the original error
    throw error
  }
}
