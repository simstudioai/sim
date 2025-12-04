import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleAdsQuery')

interface GoogleAdsQueryParams {
  accounts: string
  question?: string
  query_type?: string
  period_type?: string
  custom_start_date?: string
  custom_end_date?: string
  natural_query?: string | null
  week_number_1?: string
  week_number_2?: string
  projection_month?: string
  include_metrics?: string[]
  output_format?: string
  sort_by?: string
  developer_token?: string
  manager_customer_id?: string
}

interface GoogleAdsAccount {
  id: string
  name: string
}

// Google Ads accounts mapping
const GOOGLE_ADS_ACCOUNTS: Record<string, GoogleAdsAccount> = {
  ami: { id: '7284380454', name: 'AMI' },
  heartland: { id: '4479015711', name: 'Heartland' },
  nhi: { id: '2998186794', name: 'NHI' },
  oic_culpeper: { id: '8226685899', name: 'OIC-Culpeper' },
  odc_al: { id: '1749359003', name: 'ODC-AL' },
  cpic: { id: '1757492986', name: 'CPIC' },
  idi_fl: { id: '1890773395', name: 'IDI-FL' },
  smi: { id: '9960845284', name: 'SMI' },
  holmdel_nj: { id: '3507263995', name: 'Holmdel-NJ' },
  ft_jesse: { id: '4443836419', name: 'Ft. Jesse' },
  ud: { id: '8270553905', name: 'UD' },
  wolf_river: { id: '6445143850', name: 'Wolf River' },
  phoenix_rehab: { id: '4723354550', name: 'Phoenix Rehab (NEW - WM Invoices)' },
  au_eventgroove_products: { id: '3365918329', name: 'AU - Eventgroove Products' },
  us_eventgroove_products: { id: '4687328820', name: 'US - Eventgroove Products' },
  ca_eventgroove_products: { id: '5197514377', name: 'CA - Eventgroove Products' },
  perforated_paper: { id: '8909188371', name: 'Perforated Paper' },
  uk_eventgroove_products: { id: '7662673578', name: 'UK - Eventgroove Products' },
  monster_transmission: { id: '2680354698', name: 'Monster Transmission' },
  careadvantage: { id: '9059182052', name: 'CareAdvantage' },
  capitalcitynurses: { id: '8395621144', name: 'CapitalCityNurses.com' },
  silverlininghealthcare: { id: '4042307092', name: 'Silverlininghealthcare.com' },
  youngshc: { id: '3240333229', name: 'Youngshc.com' },
  nova_hhc: { id: '9279793056', name: 'Nova HHC' },
  inspire_aesthetics: { id: '1887900641', name: 'Inspire Aesthetics' },
  mosca_plastic_surgery: { id: '8687457378', name: 'Mosca Plastic Surgery' },
  marietta_plastic_surgery: { id: '6374556990', name: 'Marietta Plastic Surgery' },
  daniel_shapiro: { id: '7395576762', name: 'Daniel I. Shapiro, M.D., P.C.' },
  southern_coastal: { id: '2048733325', name: 'Southern Coastal' },
  plastic_surgery_center_hr: { id: '1105892184', name: 'Plastic Surgery Center of Hampton Roads' },
  epstein: { id: '1300586568', name: 'EPSTEIN' },
  covalent_metrology: { id: '3548685960', name: 'Covalent Metrology' },
  gentle_dental: { id: '2497090182', name: 'Gentle Dental' },
  great_hill_dental: { id: '6480839212', name: 'Great Hill Dental' },
  dynamic_dental: { id: '4734954125', name: 'Dynamic Dental' },
  great_lakes: { id: '9925296449', name: 'Great Lakes' },
  southern_ct_dental: { id: '7842729643', name: 'Southern Connecticut Dental Group' },
  dental_care_associates: { id: '2771541197', name: 'Dental Care Associates' },
  service_air_eastern_shore: { id: '8139983849', name: 'Service Air Eastern Shore' },
  chancey_reynolds: { id: '7098393346', name: 'Chancey & Reynolds' },
  howell_chase: { id: '1890712343', name: 'Howell Chase' },
}

function buildQueryFromParams(params: GoogleAdsQueryParams): string {
  logger.info('Building query from params', {
    params,
    naturalQueryType: typeof params.natural_query,
    naturalQueryValue: params.natural_query,
    accountsAvailable: Object.keys(GOOGLE_ADS_ACCOUNTS),
  })

  // If natural query is provided, use it as the primary query
  if (
    params.natural_query &&
    typeof params.natural_query === 'string' &&
    params.natural_query.trim().length > 0
  ) {
    const trimmedQuery = params.natural_query.trim()
    logger.info('Using natural query', { natural_query: trimmedQuery })
    return trimmedQuery
  }

  logger.info('No valid natural query, building structured query')

  // Build query from structured parameters
  const accountName = GOOGLE_ADS_ACCOUNTS[params.accounts]?.name || params.accounts
  logger.info('Building structured query', {
    accounts: params.accounts,
    accountName,
    query_type: params.query_type,
    period_type: params.period_type,
  })

  const periodMap: Record<string, string> = {
    last_7_days: 'last 7 days',
    last_15_days: 'last 15 days',
    last_30_days: 'last 30 days',
    this_month: 'this month',
    last_month: 'last month',
    this_week: 'this week',
    last_week: 'last week',
    custom: 'custom date range',
  }

  const queryTypeMap: Record<string, string> = {
    campaigns: 'campaign performance',
    performance: 'performance analysis',
    cost: 'cost analysis',
    keywords: 'keyword performance',
    week_comparison: `week ${params.week_number_1} vs week ${params.week_number_2} comparison`,
    projection: `projection analysis for ${params.projection_month}`,
  }

  const queryType = queryTypeMap[params.query_type || 'campaigns'] || 'campaign performance'
  const period = periodMap[params.period_type || 'last_30_days'] || 'last 30 days'

  let query = `Show me ${queryType} for ${accountName} for ${period}`

  // Add custom date range if specified
  if (params.period_type === 'custom' && params.custom_start_date && params.custom_end_date) {
    query = `Show me ${queryType} for ${accountName} from ${params.custom_start_date} to ${params.custom_end_date}`
  }

  logger.info('Final built query', { query })
  return query
}

function formatResults(data: any, outputFormat: string): any {
  if (!data) return data

  switch (outputFormat) {
    case 'summary':
      return {
        summary: {
          query: data.query,
          accounts_found: data.accounts_found,
          date_range: data.date_range,
          grand_totals: data.grand_totals,
        },
        account_summaries: data.results?.map((result: any) => ({
          account_name: result.account_name,
          total_campaigns: result.total_campaigns,
          account_totals: result.account_totals,
        })),
      }

    case 'csv': {
      // Convert to CSV-like structure
      const csvData: any[] = []
      data.results?.forEach((account: any) => {
        account.campaigns?.forEach((campaign: any) => {
          csvData.push({
            account_name: account.account_name,
            campaign_name: campaign.name,
            status: campaign.status,
            clicks: campaign.clicks,
            impressions: campaign.impressions,
            cost: campaign.cost,
            conversions: campaign.conversions,
            ctr: campaign.ctr,
            avg_cpc: campaign.avg_cpc,
          })
        })
      })
      return { csv_data: csvData, original_data: data }
    }

    case 'chart': {
      // Format for chart visualization
      const chartData = {
        accounts: data.results?.map((account: any) => ({
          name: account.account_name,
          clicks: account.account_totals?.clicks || 0,
          impressions: account.account_totals?.impressions || 0,
          cost: account.account_totals?.cost || 0,
          conversions: account.account_totals?.conversions || 0,
        })),
        campaigns: data.results?.flatMap((account: any) =>
          account.campaigns?.map((campaign: any) => ({
            account: account.account_name,
            campaign: campaign.name,
            clicks: campaign.clicks,
            cost: campaign.cost,
            conversions: campaign.conversions,
          }))
        ),
        totals: data.grand_totals,
      }
      return { chart_data: chartData, original_data: data }
    }

    default:
      return data
  }
}

export const googleAdsQueryTool: ToolConfig<GoogleAdsQueryParams, any> = {
  id: 'google_ads_query',
  name: 'Google Ads Query',
  description: 'Query Google Ads campaign data and analytics',
  version: '1.0.0',

  params: {
    accounts: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Ads account key to query',
    },
    question: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User question about Google Ads data',
    },
    query_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of query to perform',
    },
    period_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time period for the query',
    },
    output_format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Format for output data',
    },
    sort_by: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort results by specified metric',
    },
  },

  request: {
    url: () => '/api/google-ads/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleAdsQueryParams) => ({
      query:
        params.question ||
        buildQueryFromParams({
          ...params,
          query_type: params.query_type || 'campaigns',
          period_type: params.period_type || 'last_30_days',
          output_format: params.output_format || 'detailed',
          sort_by: params.sort_by || 'cost_desc',
        }),
      accounts: params.accounts,
      // Don't pass period_type - let AI detect it from the question
      output_format: params.output_format || 'detailed',
      sort_by: params.sort_by || 'cost_desc',
    }),
  },

  transformResponse: async (response: Response, params?: GoogleAdsQueryParams) => {
    try {
      logger.info('Processing Google Ads response', {
        status: response.status,
        account: params?.accounts,
        url: response.url,
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Response not ok', { status: response.status, errorText })
        throw new Error(
          `Google Ads API error: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      const data = await response.json()
      logger.info('Response data received', {
        dataKeys: Object.keys(data),
        hasResults: !!data.results,
        resultsLength: data.results?.length,
      })

      // Check for API errors
      if (data.error) {
        logger.error('API returned error', { error: data.error })
        throw new Error(`Google Ads API error: ${data.error}`)
      }

      logger.info('Google Ads query completed successfully', {
        accounts_found: data.accounts_found,
        total_campaigns: data.results?.reduce(
          (sum: number, account: any) => sum + (account.total_campaigns || 0),
          0
        ),
        grand_total_cost: data.grand_totals?.cost,
      })

      const finalResult = {
        success: true,
        output: data,
      }

      logger.info('Returning final result', {
        finalResultKeys: Object.keys(finalResult),
        success: finalResult.success,
        hasOutput: !!finalResult.output,
        outputKeys: finalResult.output ? Object.keys(finalResult.output) : [],
      })

      return finalResult
    } catch (error) {
      logger.error('Google Ads query failed', { error })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }
    }
  },
}
