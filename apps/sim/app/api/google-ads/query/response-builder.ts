import type { AccountResult, GaqlQueryResult, ProcessedResults } from './types'

/**
 * Builds the account result object with totals and calculated metrics
 */
export function buildAccountResult(
  accountId: string,
  accountName: string,
  primaryResults: ProcessedResults
): AccountResult {
  return {
    account_id: accountId,
    account_name: accountName,
    campaigns: primaryResults.campaigns,
    result: primaryResults.result,
    gaqlQuery: primaryResults.gaqlQuery,
    total_campaigns: primaryResults.campaigns.length,
    account_totals: {
      clicks: primaryResults.accountTotals.clicks,
      impressions: primaryResults.accountTotals.impressions,
      cost: primaryResults.accountTotals.cost,
      conversions: primaryResults.accountTotals.conversions,
      conversions_value: primaryResults.accountTotals.conversions_value,
      ctr:
        primaryResults.accountTotals.impressions > 0
          ? Math.round(
              (primaryResults.accountTotals.clicks / primaryResults.accountTotals.impressions) *
                100 *
                100
            ) / 100
          : 0,
      avg_cpc:
        primaryResults.accountTotals.clicks > 0
          ? Math.round(
              (primaryResults.accountTotals.cost / primaryResults.accountTotals.clicks) * 100
            ) / 100
          : 0,
      conversion_rate:
        primaryResults.accountTotals.clicks > 0
          ? Math.round(
              (primaryResults.accountTotals.conversions / primaryResults.accountTotals.clicks) *
                100 *
                100
            ) / 100
          : 0,
      cost_per_conversion:
        primaryResults.accountTotals.conversions > 0
          ? Math.round(
              (primaryResults.accountTotals.cost / primaryResults.accountTotals.conversions) * 100
            ) / 100
          : 0,
    },
  }
}

/**
 * Adds comparison data to account result if available
 */
export function addComparisonToAccountResult(
  accountResult: AccountResult,
  comparisonResults: ProcessedResults
): void {
  ;(accountResult as any).comparison_campaigns = comparisonResults.campaigns
  ;(accountResult as any).comparison_totals = {
    clicks: comparisonResults.accountTotals.clicks,
    impressions: comparisonResults.accountTotals.impressions,
    cost: comparisonResults.accountTotals.cost,
    conversions: comparisonResults.accountTotals.conversions,
    conversions_value: comparisonResults.accountTotals.conversions_value,
    ctr:
      comparisonResults.accountTotals.impressions > 0
        ? Math.round(
            (comparisonResults.accountTotals.clicks / comparisonResults.accountTotals.impressions) *
              100 *
              100
          ) / 100
        : 0,
    avg_cpc:
      comparisonResults.accountTotals.clicks > 0
        ? Math.round(
            (comparisonResults.accountTotals.cost / comparisonResults.accountTotals.clicks) * 100
          ) / 100
        : 0,
    conversion_rate:
      comparisonResults.accountTotals.clicks > 0
        ? Math.round(
            (comparisonResults.accountTotals.conversions / comparisonResults.accountTotals.clicks) *
              100 *
              100
          ) / 100
        : 0,
    cost_per_conversion:
      comparisonResults.accountTotals.conversions > 0
        ? Math.round(
            (comparisonResults.accountTotals.cost / comparisonResults.accountTotals.conversions) *
              100
          ) / 100
        : 0,
  }
}

/**
 * Builds the complete API response structure
 */
export function buildApiResponse(
  query: string,
  queryResult: GaqlQueryResult,
  accountInfo: { id: string; name: string },
  primaryResults: ProcessedResults,
  comparisonResults: ProcessedResults | null,
  accountResult: AccountResult
) {
  const {
    startDate,
    endDate,
    isComparison,
    comparisonStartDate,
    comparisonEndDate,
    queryType,
    periodType,
  } = queryResult

  return {
    query,
    query_type: queryType,
    period_type: periodType,
    is_comparison: isComparison || false,
    accounts_found: 1,

    // Main Week Data (Current/Requested Period)
    mainWeek: {
      dateRange: `${startDate} to ${endDate}`,
      totals: {
        clicks: primaryResults.accountTotals.clicks,
        impressions: primaryResults.accountTotals.impressions,
        cost: primaryResults.accountTotals.cost,
        conversions: primaryResults.accountTotals.conversions,
        conversions_value: primaryResults.accountTotals.conversions_value || 0,
        ctr:
          primaryResults.accountTotals.impressions > 0
            ? Math.round(
                (primaryResults.accountTotals.clicks / primaryResults.accountTotals.impressions) *
                  100 *
                  100
              ) / 100
            : 0,
        avg_cpc:
          primaryResults.accountTotals.clicks > 0
            ? Math.round(
                (primaryResults.accountTotals.cost / primaryResults.accountTotals.clicks) * 100
              ) / 100
            : 0,
        conversion_rate:
          primaryResults.accountTotals.clicks > 0
            ? Math.round(
                (primaryResults.accountTotals.conversions / primaryResults.accountTotals.clicks) *
                  100 *
                  100
              ) / 100
            : 0,
        cost_per_conversion:
          primaryResults.accountTotals.conversions > 0
            ? Math.round(
                (primaryResults.accountTotals.cost / primaryResults.accountTotals.conversions) * 100
              ) / 100
            : 0,
      },
      campaigns: primaryResults.campaigns,
    },

    // Comparison Week Data (Previous Period) - Only if comparison requested
    comparisonWeek: comparisonResults
      ? {
          dateRange: `${comparisonStartDate} to ${comparisonEndDate}`,
          totals: {
            clicks: comparisonResults.accountTotals.clicks,
            impressions: comparisonResults.accountTotals.impressions,
            cost: comparisonResults.accountTotals.cost,
            conversions: comparisonResults.accountTotals.conversions,
            conversions_value: comparisonResults.accountTotals.conversions_value || 0,
            ctr:
              comparisonResults.accountTotals.impressions > 0
                ? Math.round(
                    (comparisonResults.accountTotals.clicks /
                      comparisonResults.accountTotals.impressions) *
                      100 *
                      100
                  ) / 100
                : 0,
            avg_cpc:
              comparisonResults.accountTotals.clicks > 0
                ? Math.round(
                    (comparisonResults.accountTotals.cost /
                      comparisonResults.accountTotals.clicks) *
                      100
                  ) / 100
                : 0,
            conversion_rate:
              comparisonResults.accountTotals.clicks > 0
                ? Math.round(
                    (comparisonResults.accountTotals.conversions /
                      comparisonResults.accountTotals.clicks) *
                      100 *
                      100
                  ) / 100
                : 0,
            cost_per_conversion:
              comparisonResults.accountTotals.conversions > 0
                ? Math.round(
                    (comparisonResults.accountTotals.cost /
                      comparisonResults.accountTotals.conversions) *
                      100
                  ) / 100
                : 0,
          },
          campaigns: comparisonResults.campaigns,
        }
      : null,

    // Legacy fields for backward compatibility
    date_range: `${startDate} to ${endDate}`,
    comparison_date_range: isComparison ? `${comparisonStartDate} to ${comparisonEndDate}` : null,
    grand_totals: {
      clicks: primaryResults.accountTotals.clicks,
      impressions: primaryResults.accountTotals.impressions,
      cost: primaryResults.accountTotals.cost,
      conversions: primaryResults.accountTotals.conversions,
      conversions_value: primaryResults.accountTotals.conversions_value || 0,
    },

    results: [accountResult],

    data_availability: {
      overall_status: 'available',
      accounts: [
        {
          account_name: accountInfo.name,
          account_id: accountInfo.id,
          data_available: true,
          latest_data_date: endDate,
          requested_range: `${startDate} to ${endDate}`,
          comparison_range: isComparison ? `${comparisonStartDate} to ${comparisonEndDate}` : null,
          days_behind: 1,
          message: isComparison
            ? `Data available for both periods: ${startDate} to ${endDate} and ${comparisonStartDate} to ${comparisonEndDate}`
            : `Data available until ${endDate}`,
        },
      ],
      summary: '1/1 accounts have requested data',
    },
  }
}
