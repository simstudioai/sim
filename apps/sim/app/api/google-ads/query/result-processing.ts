import { createLogger } from '@/lib/logs/console/logger'
import { MICROS_PER_DOLLAR } from './constants'
import type { Campaign, ProcessedResults } from './types'

const logger = createLogger('ResultProcessing')

/**
 * Processes Google Ads API results and converts them to structured format
 */
export function processGoogleAdsResults(
  apiResult: any,
  requestId: string,
  gaqlQuery: string,
  periodLabel = 'primary'
): ProcessedResults {
  const campaigns: Campaign[] = []
  const result: any[] = []
  let accountClicks = 0
  let accountImpressions = 0
  let accountCost = 0
  let accountConversions = 0
  let accountConversionsValue = 0

  if (apiResult.results && Array.isArray(apiResult.results)) {
    logger.info(
      `[${requestId}] Processing ${apiResult.results.length} results from Google Ads API (${periodLabel} period)`
    )

    for (const gaqlResult of apiResult.results) {
      // Log the structure of each result to understand the API response format
      logger.debug(`[${requestId}] Processing result (${periodLabel})`, {
        resultKeys: Object.keys(gaqlResult),
        hasCampaign: !!gaqlResult.campaign,
        hasMetrics: !!gaqlResult.metrics,
        campaignKeys: gaqlResult.campaign ? Object.keys(gaqlResult.campaign) : [],
        metricsKeys: gaqlResult.metrics ? Object.keys(gaqlResult.metrics) : [],
      })

      // Map the raw GAQL result to the result array
      const mappedResult: any = {
        // Include all original GAQL result fields
        ...gaqlResult,
      }

      result.push(mappedResult)

      const campaignData = gaqlResult.campaign
      const metricsData = gaqlResult.metrics

      // Add safety checks for undefined metricsData
      if (!metricsData) {
        logger.warn(`[${requestId}] Skipping result with missing metrics data (${periodLabel})`, {
          resultKeys: Object.keys(gaqlResult),
          campaignName: campaignData?.name || 'Unknown',
        })
        continue
      }

      const clicks = Number.parseInt(metricsData.clicks || '0')
      const impressions = Number.parseInt(metricsData.impressions || '0')
      const costMicros = Number.parseInt(metricsData.costMicros || '0')
      const conversions = Number.parseFloat(metricsData.conversions || '0')
      const conversionsValue = Number.parseFloat(metricsData.conversionsValue || '0')
      const avgCpcMicros = Number.parseInt(metricsData.averageCpc || '0')
      const costPerConversionMicros = Number.parseInt(metricsData.costPerConversion || '0')
      const impressionShare = Number.parseFloat(metricsData.searchImpressionShare || '0')
      const budgetLostShare = Number.parseFloat(metricsData.searchBudgetLostImpressionShare || '0')
      const rankLostShare = Number.parseFloat(metricsData.searchRankLostImpressionShare || '0')

      // Calculate conversion rate manually (conversions / clicks * 100)
      const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0

      accountClicks += clicks
      accountImpressions += impressions
      accountCost += costMicros
      accountConversions += conversions
      accountConversionsValue += conversionsValue

      const campaignInfo: Campaign = {
        name: campaignData.name || 'Unknown',
        status: campaignData.status || 'Unknown',
        clicks,
        impressions,
        cost: Math.round((costMicros / MICROS_PER_DOLLAR) * 100) / 100,
        conversions,
        conversions_value: Math.round(conversionsValue * 100) / 100,
        ctr: Math.round(Number.parseFloat(metricsData.ctr || '0') * 10000) / 100,
        avg_cpc: Math.round((avgCpcMicros / MICROS_PER_DOLLAR) * 100) / 100,
        cost_per_conversion:
          costPerConversionMicros > 0
            ? Math.round((costPerConversionMicros / MICROS_PER_DOLLAR) * 100) / 100
            : 0,
        conversion_rate: Math.round(conversionRate * 100) / 100,
        impression_share: Math.round(impressionShare * 10000) / 100,
        budget_lost_share: Math.round(budgetLostShare * 10000) / 100,
        rank_lost_share: Math.round(rankLostShare * 10000) / 100,
        roas:
          costMicros > 0
            ? Math.round((conversionsValue / (costMicros / MICROS_PER_DOLLAR)) * 100) / 100
            : 0,
      }
      campaigns.push(campaignInfo)
    }
  } else {
    logger.warn(`[${requestId}] No results found in Google Ads API response (${periodLabel})`, {
      hasResults: !!apiResult.results,
      resultsType: typeof apiResult.results,
      isArray: Array.isArray(apiResult.results),
      apiResultKeys: Object.keys(apiResult),
    })
  }

  return {
    result,
    campaigns,
    gaqlQuery,
    accountTotals: {
      clicks: accountClicks,
      impressions: accountImpressions,
      cost: Math.round((accountCost / MICROS_PER_DOLLAR) * 100) / 100,
      conversions: accountConversions,
      conversions_value: Math.round(accountConversionsValue * 100) / 100,
    },
  }
}
