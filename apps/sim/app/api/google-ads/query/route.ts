import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { generateSmartGAQL } from './ai-query-generation'
import { GOOGLE_ADS_ACCOUNTS } from './constants'
import { makeGoogleAdsRequest } from './google-ads-api'
import {
  addComparisonToAccountResult,
  buildAccountResult,
  buildApiResponse,
} from './response-builder'
import { processGoogleAdsResults } from './result-processing'
import type { AccountResult, GoogleAdsRequest } from './types'

const logger = createLogger('GoogleAdsAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Google Ads query request started`)

    const body: GoogleAdsRequest = await request.json()
    logger.info(`[${requestId}] Request body received`, { body })

    const { query, accounts } = body

    if (!query) {
      logger.error(`[${requestId}] No query provided in request`)
      return NextResponse.json({ error: 'No query provided' }, { status: 400 })
    }

    logger.info(`[${requestId}] Processing query`, { query, accounts })

    // Get account information first
    logger.info(`[${requestId}] Looking up account`, {
      accounts,
      availableAccounts: Object.keys(GOOGLE_ADS_ACCOUNTS),
    })

    const accountInfo = GOOGLE_ADS_ACCOUNTS[accounts]
    if (!accountInfo) {
      logger.error(`[${requestId}] Invalid account key`, {
        accounts,
        availableAccounts: Object.keys(GOOGLE_ADS_ACCOUNTS),
      })
      return NextResponse.json(
        {
          error: `Invalid account key: ${accounts}. Available accounts: ${Object.keys(GOOGLE_ADS_ACCOUNTS).join(', ')}`,
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Found account`, {
      accountId: accountInfo.id,
      accountName: accountInfo.name,
    })

    // Use smart parsing to generate GAQL query based on the user's question
    const queryResult = await generateSmartGAQL(query, accountInfo.name)

    logger.info(`[${requestId}] Smart-generated query details`, {
      queryType: queryResult.queryType,
      periodType: queryResult.periodType,
      dateRange: `${queryResult.startDate} to ${queryResult.endDate}`,
      account: accountInfo.name,
      gaqlQuery: queryResult.gaqlQuery,
      isComparison: queryResult.isComparison,
      comparisonDateRange: queryResult.isComparison
        ? `${queryResult.comparisonStartDate} to ${queryResult.comparisonEndDate}`
        : null,
    })

    // Make the API request(s) using the actual account ID and generated query
    logger.info(`[${requestId}] ===== MAIN WEEK QUERY =====`, {
      dateRange: `${queryResult.startDate} to ${queryResult.endDate}`,
      query: queryResult.gaqlQuery,
    })
    const apiResult = await makeGoogleAdsRequest(accountInfo.id, queryResult.gaqlQuery)
    let comparisonApiResult = null

    // If this is a comparison query, make a second API call for the comparison period
    if (queryResult.isComparison && queryResult.comparisonQuery) {
      logger.info(`[${requestId}] ===== COMPARISON WEEK QUERY =====`, {
        dateRange: `${queryResult.comparisonStartDate} to ${queryResult.comparisonEndDate}`,
        query: queryResult.comparisonQuery,
      })
      comparisonApiResult = await makeGoogleAdsRequest(accountInfo.id, queryResult.comparisonQuery)
    }

    // Process primary period results
    const primaryResults = processGoogleAdsResults(
      apiResult,
      requestId,
      queryResult.gaqlQuery,
      'primary'
    )
    logger.info(`[${requestId}] ===== MAIN WEEK TOTALS =====`, {
      dateRange: `${queryResult.startDate} to ${queryResult.endDate}`,
      cost: primaryResults.accountTotals.cost,
      clicks: primaryResults.accountTotals.clicks,
      conversions: primaryResults.accountTotals.conversions,
      conversions_value: primaryResults.accountTotals.conversions_value,
      campaigns: primaryResults.campaigns.length,
    })

    // Process comparison period results if available
    let comparisonResults = null
    if (comparisonApiResult && queryResult.comparisonQuery) {
      comparisonResults = processGoogleAdsResults(
        comparisonApiResult,
        requestId,
        queryResult.comparisonQuery,
        'comparison'
      )
      logger.info(`[${requestId}] ===== COMPARISON WEEK TOTALS =====`, {
        dateRange: `${queryResult.comparisonStartDate} to ${queryResult.comparisonEndDate}`,
        cost: comparisonResults.accountTotals.cost,
        clicks: comparisonResults.accountTotals.clicks,
        conversions: comparisonResults.accountTotals.conversions,
        conversions_value: comparisonResults.accountTotals.conversions_value,
        campaigns: comparisonResults.campaigns.length,
      })
    }

    // Build account result
    const accountResult: AccountResult = buildAccountResult(
      accountInfo.id,
      accountInfo.name,
      primaryResults
    )

    // Add comparison data to account result if available
    if (comparisonResults) {
      addComparisonToAccountResult(accountResult, comparisonResults)
    }

    // Build complete API response
    const response = buildApiResponse(
      query,
      queryResult,
      accountInfo,
      primaryResults,
      comparisonResults,
      accountResult
    )

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Google Ads query completed successfully`, {
      executionTime,
      accountsFound: 1,
      totalCampaigns: primaryResults.campaigns.length,
      grandTotalCost: response.grand_totals.cost,
      isComparison: queryResult.isComparison,
      comparisonCampaigns: comparisonResults?.campaigns.length || 0,
      comparisonTotalCost: comparisonResults?.accountTotals.cost || 0,
    })

    logger.info(`[${requestId}] Returning response`, {
      responseKeys: Object.keys(response),
      resultsLength: response.results.length,
      firstResult: response.results[0]
        ? {
            account_name: response.results[0].account_name,
            campaigns_count: response.results[0].campaigns.length,
          }
        : null,
    })

    return NextResponse.json(response)
  } catch (error) {
    const executionTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    logger.error(`[${requestId}] Google Ads query failed`, {
      error: errorMessage,
      executionTime,
    })

    // Check if this is a date extraction error (already has helpful message)
    const isDateExtractionError = errorMessage.includes('Unable to extract a date range')

    // Check if this is a token limit error (already has helpful message)
    const isTokenLimitError = errorMessage.includes('date range in your query is too large')

    // If it's a user-friendly error (date extraction or token limit), return it as-is
    if (isDateExtractionError || isTokenLimitError) {
      return NextResponse.json(
        {
          error: errorMessage,
          details: isDateExtractionError
            ? 'Date extraction failed - please provide a clearer date specification'
            : 'Token limit exceeded - please use a smaller date range',
          suggestion: 'Please re-run the agent with the suggested changes.',
        },
        { status: 400 } // 400 Bad Request for user input issues
      )
    }

    // For other errors, return generic error message
    return NextResponse.json(
      {
        error: errorMessage,
        details: 'Failed to process Google Ads query',
        suggestion:
          'Please check your query and try again. If the issue persists, try using a smaller date range or rephrasing your question.',
      },
      { status: 500 }
    )
  }
}
