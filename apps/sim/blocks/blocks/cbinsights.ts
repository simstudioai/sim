import { Building, ListChecks, Search, Sparkles, Sprout, Users } from '@sim/emcn/icons'
import { CbInsightsIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { CbInsightsResponse } from '@/tools/cbinsights/types'

/** Operations that take a single organization ID on the path. */
const ORG_OPERATIONS = [
  'get_org_fundings',
  'get_org_investments',
  'get_org_portfolio_exits',
  'get_org_business_relationships',
  'get_org_management_and_board',
  'get_org_outlook',
  'get_org_funding_window',
  'get_org_revenue',
  'get_mosaic_history',
  'get_commercial_maturity_history',
  'get_exit_probability_history',
  'get_strategy_map',
  'get_scouting_report',
] as const

/** Operations that take 1-100 organization IDs in the body. */
const ORG_LIST_OPERATIONS = [
  'list_fundings',
  'list_investments',
  'list_portfolio_exits',
  'list_business_relationships',
  'list_management_and_board',
  'list_outlook',
  'list_funding_window',
  'list_revenue',
] as const

/** Operations whose endpoint accepts a `limit`. */
const LIMITED_OPERATIONS = [
  'lookup_organizations',
  'search_firmographics',
  'get_org_fundings',
  'get_org_investments',
  'list_fundings',
  'list_investments',
  'list_portfolio_exits',
]

/** Operations paged with the shared continuation token. */
const PAGED_OPERATIONS = [
  'lookup_organizations',
  'search_firmographics',
  'get_org_fundings',
  'get_org_investments',
  'list_fundings',
  'list_investments',
  'list_portfolio_exits',
  'list_business_relationships',
]

/** Operations that filter returned people by title. */
const TITLE_FILTER_OPERATIONS = ['get_org_management_and_board', 'list_management_and_board']

/** Operations whose history window is bounded by a start and an end date. */
const DATE_RANGE_OPERATIONS = ['get_commercial_maturity_history', 'get_exit_probability_history']

export const CbInsightsBlock: BlockConfig<CbInsightsResponse> = {
  type: 'cbinsights',
  name: 'CB Insights',
  description: 'Research private markets — firmographics, funding, and predictive scores',
  longDescription:
    'Integrates the CB Insights API v2 into the workflow. Resolve companies to CB Insights IDs for free, search firmographics across markets and geographies, pull funding rounds, cap tables, investments, and exits, map business relationships, read leadership and board history, and retrieve the proprietary Mosaic Score, Commercial Maturity, and Exit Probability outlooks. Generate AI Scouting Reports, or ask ChatCBI directly. Which datasets answer depends on your CB Insights license.',
  docsLink: 'https://docs.sim.ai/integrations/cbinsights',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: CbInsightsIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'CB Insights',
    sentences: {
      byOperation: {
        lookup_organizations: [
          'Look up organizations',
          { text: 'named', field: 'names' },
          { text: 'at', field: 'urls' },
        ],
        search_firmographics: [
          'Search company profiles',
          { text: 'matching', field: 'keyword', core: true },
        ],
        get_org_fundings: [{ text: 'Read funding rounds for org', field: 'orgId', core: true }],
        get_org_investments: [{ text: 'Read investments by org', field: 'orgId', core: true }],
        get_org_portfolio_exits: [
          { text: 'Read portfolio exits for org', field: 'orgId', core: true },
        ],
        get_org_business_relationships: [
          { text: 'Read business relationships for org', field: 'orgId', core: true },
        ],
        get_org_management_and_board: [
          { text: 'Read management and board for org', field: 'orgId', core: true },
        ],
        get_org_outlook: [{ text: 'Read the outlook for org', field: 'orgId', core: true }],
        get_org_funding_window: [
          { text: 'Estimate the next funding window for org', field: 'orgId', core: true },
        ],
        get_org_revenue: [{ text: 'Read revenue by year for org', field: 'orgId', core: true }],
        get_mosaic_history: [{ text: 'Read Mosaic history for org', field: 'orgId', core: true }],
        get_commercial_maturity_history: [
          { text: 'Read commercial maturity history for org', field: 'orgId', core: true },
        ],
        get_exit_probability_history: [
          { text: 'Read exit probability history for org', field: 'orgId', core: true },
        ],
        get_strategy_map: [{ text: 'Map the strategy of org', field: 'orgId', core: true }],
        get_scouting_report: [
          { text: 'Generate a scouting report for org', field: 'orgId', core: true },
        ],
        list_fundings: [{ text: 'Read funding rounds for orgs', field: 'orgIds', core: true }],
        list_investments: [{ text: 'Read investments by orgs', field: 'orgIds', core: true }],
        list_portfolio_exits: [
          { text: 'Read portfolio exits for orgs', field: 'orgIds', core: true },
        ],
        list_business_relationships: [
          { text: 'Read business relationships for orgs', field: 'orgIds', core: true },
        ],
        list_management_and_board: [
          { text: 'Read management and board for orgs', field: 'orgIds', core: true },
        ],
        list_outlook: [{ text: 'Read the outlook for orgs', field: 'orgIds', core: true }],
        list_funding_window: [
          { text: 'Estimate next funding windows for orgs', field: 'orgIds', core: true },
        ],
        list_revenue: [{ text: 'Read revenue by year for orgs', field: 'orgIds', core: true }],
        chat: [{ text: 'Ask ChatCBI', field: 'message', core: true }],
        rag: [{ text: 'Retrieve CB Insights context for', field: 'message', core: true }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Look Up Organizations', id: 'lookup_organizations' },
        { label: 'Search Firmographics', id: 'search_firmographics' },
        { label: 'Get Organization Fundings', id: 'get_org_fundings' },
        { label: 'Get Organization Investments', id: 'get_org_investments' },
        { label: 'Get Organization Portfolio Exits', id: 'get_org_portfolio_exits' },
        { label: 'Get Organization Business Relationships', id: 'get_org_business_relationships' },
        { label: 'Get Organization Management and Board', id: 'get_org_management_and_board' },
        { label: 'Get Organization Outlook', id: 'get_org_outlook' },
        { label: 'Get Organization Funding Window', id: 'get_org_funding_window' },
        { label: 'Get Organization Revenue', id: 'get_org_revenue' },
        { label: 'Get Mosaic History', id: 'get_mosaic_history' },
        { label: 'Get Commercial Maturity History', id: 'get_commercial_maturity_history' },
        { label: 'Get Exit Probability History', id: 'get_exit_probability_history' },
        { label: 'Get Strategy Map', id: 'get_strategy_map' },
        { label: 'Get Scouting Report', id: 'get_scouting_report' },
        { label: 'List Fundings', id: 'list_fundings' },
        { label: 'List Investments', id: 'list_investments' },
        { label: 'List Portfolio Exits', id: 'list_portfolio_exits' },
        { label: 'List Business Relationships', id: 'list_business_relationships' },
        { label: 'List Management and Board', id: 'list_management_and_board' },
        { label: 'List Outlook', id: 'list_outlook' },
        { label: 'List Funding Windows', id: 'list_funding_window' },
        { label: 'List Revenue', id: 'list_revenue' },
        { label: 'Ask ChatCBI', id: 'chat' },
        { label: 'Retrieve Context', id: 'rag' },
      ],
      value: () => 'lookup_organizations',
    },
    {
      id: 'clientId',
      title: 'CB Insights Client ID',
      type: 'short-input',
      placeholder: 'Enter your CB Insights client ID',
      password: true,
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'CB Insights Client Secret',
      type: 'short-input',
      placeholder: 'Enter your CB Insights client secret',
      password: true,
      required: true,
    },
    {
      id: 'orgId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'e.g. 129410',
      condition: { field: 'operation', value: [...ORG_OPERATIONS] },
      required: { field: 'operation', value: [...ORG_OPERATIONS] },
    },
    {
      id: 'orgIds',
      title: 'Organization IDs',
      type: 'short-input',
      placeholder: 'e.g. 129410, 1034157 (up to 100)',
      condition: { field: 'operation', value: [...ORG_LIST_OPERATIONS] },
      required: { field: 'operation', value: [...ORG_LIST_OPERATIONS] },
    },
    {
      id: 'message',
      title: 'Question',
      type: 'long-input',
      placeholder:
        'Which emerging technology markets are seeing the highest equity funding growth?',
      condition: { field: 'operation', value: ['chat', 'rag'] },
      required: { field: 'operation', value: ['chat', 'rag'] },
    },
    {
      id: 'names',
      title: 'Names',
      type: 'short-input',
      placeholder: 'e.g. CB Insights, Stripe',
      condition: { field: 'operation', value: 'lookup_organizations' },
    },
    {
      id: 'urls',
      title: 'Websites',
      type: 'short-input',
      placeholder: 'e.g. cbinsights.com, stripe.com',
      condition: { field: 'operation', value: 'lookup_organizations' },
    },
    {
      id: 'profileUrl',
      title: 'Profile URL',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'https://app.cbinsights.com/profiles/c/...',
      condition: { field: 'operation', value: 'lookup_organizations' },
    },
    {
      id: 'keyword',
      title: 'Keyword',
      type: 'short-input',
      placeholder: 'Search names, descriptions, and aliases',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'marketNames',
      title: 'Market Names',
      type: 'short-input',
      placeholder: 'e.g. Large language model (LLM) developers, Web3 wallets',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'chatId',
      title: 'Conversation ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Continue a previous ChatCBI conversation',
      condition: { field: 'operation', value: 'chat' },
    },
    {
      id: 'titleIds',
      title: 'Title IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 50, 75',
      condition: { field: 'operation', value: TITLE_FILTER_OPERATIONS },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: [...DATE_RANGE_OPERATIONS, 'get_mosaic_history'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: DATE_RANGE_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'orgIdFilter',
      title: 'Organization IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 129410, 129411',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'orgNames',
      title: 'Exact Names',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. CB Insights',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'firmographicsUrls',
      title: 'Websites',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. cbinsights.com',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'tickers',
      title: 'Tickers',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. AAPL, APC:BE',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'marketIds',
      title: 'Market IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 6, 95, 106',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'sectorIds',
      title: 'Sector IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 4',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'industryIds',
      title: 'Industry IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 144',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'subindustryIds',
      title: 'Sub-industry IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 87',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'businessModelIds',
      title: 'Business Model IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 7',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'technologyIds',
      title: 'Technology IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 1',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'collectionIds',
      title: 'Expert Collection IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 3285',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'countryIds',
      title: 'Country IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 1',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'stateProvinceIds',
      title: 'State / Province IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 32',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'cityIds',
      title: 'City IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 3033',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'continentIds',
      title: 'Continent IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 6',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'regionIds',
      title: 'Region IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 5',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'orgStatusIds',
      title: 'Organization Status IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 5',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'investorOrgIds',
      title: 'Invested-in By',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Investor organization IDs',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'investorTypeIds',
      title: 'Investor Type IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 14',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'fundingInvestorTypeIds',
      title: 'Funded By Investor Types',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 14',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'lastFundingRoundIds',
      title: 'Last Funding Round IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 108',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'lastFundingRoundCategoryIds',
      title: 'Last Round Category IDs',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 2',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'minCurrentHeadcount',
      title: 'Min Headcount',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 50',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'maxCurrentHeadcount',
      title: 'Max Headcount',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 500',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'minTotalFundingInMillions',
      title: 'Min Total Funding ($M)',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 10',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'maxTotalFundingInMillions',
      title: 'Max Total Funding ($M)',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 500',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'minValuationInMillions',
      title: 'Min Valuation ($M)',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 100',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'maxValuationInMillions',
      title: 'Max Valuation ($M)',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 5000',
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'minLastFundingDate',
      title: 'Funded On or After',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'search_firmographics' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'maxLastFundingDate',
      title: 'Funded On or Before',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'search_firmographics' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'vcBacked',
      title: 'VC Backed Only',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'sortField',
      title: 'Sort Field',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Organization name', id: 'orgName' },
        { label: 'Organization ID', id: 'orgId' },
        { label: 'Last update time', id: 'lastUpdateTime' },
        { label: 'Last funding date', id: 'lastFundingDate' },
        { label: 'Latest valuation', id: 'latestValuation' },
        { label: 'Mosaic overall', id: 'mosaicOverall' },
        { label: 'Mosaic management', id: 'mosaicManagement' },
        { label: 'Mosaic market', id: 'mosaicMarket' },
        { label: 'Mosaic momentum', id: 'mosaicMomentum' },
        { label: 'Mosaic money', id: 'mosaicMoney' },
        { label: 'Current headcount', id: 'headcountCurrent' },
        { label: 'Headcount growth (6mo)', id: 'headcount6MonthGrowth' },
        { label: 'Headcount growth (12mo)', id: 'headcount12MonthGrowth' },
        { label: 'Headcount growth (24mo)', id: 'headcount24MonthGrowth' },
      ],
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'sortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      condition: { field: 'operation', value: 'search_firmographics' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Rows per page, 1-100',
      condition: { field: 'operation', value: LIMITED_OPERATIONS },
    },
    {
      id: 'nextPageToken',
      title: 'Next Page Token',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Continuation token from a previous run',
      condition: { field: 'operation', value: PAGED_OPERATIONS },
    },
  ],

  tools: {
    access: [
      'cbinsights_lookup_organizations',
      'cbinsights_search_firmographics',
      'cbinsights_get_org_fundings',
      'cbinsights_get_org_investments',
      'cbinsights_get_org_portfolio_exits',
      'cbinsights_get_org_business_relationships',
      'cbinsights_get_org_management_and_board',
      'cbinsights_get_org_outlook',
      'cbinsights_get_org_funding_window',
      'cbinsights_get_org_revenue',
      'cbinsights_get_mosaic_history',
      'cbinsights_get_commercial_maturity_history',
      'cbinsights_get_exit_probability_history',
      'cbinsights_get_strategy_map',
      'cbinsights_get_scouting_report',
      'cbinsights_list_fundings',
      'cbinsights_list_investments',
      'cbinsights_list_portfolio_exits',
      'cbinsights_list_business_relationships',
      'cbinsights_list_management_and_board',
      'cbinsights_list_outlook',
      'cbinsights_list_funding_window',
      'cbinsights_list_revenue',
      'cbinsights_chat',
      'cbinsights_rag',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation ?? '')
        const toolId = `cbinsights_${operation}`
        if (!CbInsightsBlock.tools.access.includes(toolId)) {
          throw new Error(`Invalid CB Insights operation: ${params.operation}`)
        }
        return toolId
      },
      /**
       * Every key the block can send is assigned unconditionally.
       *
       * The executor merges the raw subblock state underneath this result, so
       * omitting a key leaves the previous operation's value on the wire — an
       * advanced field is serialized on non-emptiness alone, even while the UI
       * hides it. `undefined` is what actually drops one.
       */
      params: (params) => {
        const operation = String(params.operation ?? '')
        const isOrg = (ORG_OPERATIONS as readonly string[]).includes(operation)
        const isOrgList = (ORG_LIST_OPERATIONS as readonly string[]).includes(operation)
        const isFirmographics = operation === 'search_firmographics'
        const isLookup = operation === 'lookup_organizations'
        const isChat = operation === 'chat'
        const isAi = isChat || operation === 'rag'
        const hasTitles = TITLE_FILTER_OPERATIONS.includes(operation)
        const hasDateRange = DATE_RANGE_OPERATIONS.includes(operation)
        const firmographic = (value: unknown) => (isFirmographics ? value : undefined)

        return {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          orgId: isOrg ? params.orgId : undefined,
          orgIds: isOrgList ? params.orgIds : firmographic(params.orgIdFilter),
          message: isAi ? params.message : undefined,
          chatId: isChat ? params.chatId : undefined,
          names: isLookup ? params.names : undefined,
          urls: isLookup ? params.urls : firmographic(params.firmographicsUrls),
          profileUrl: isLookup ? params.profileUrl : undefined,
          keyword: firmographic(params.keyword),
          orgNames: firmographic(params.orgNames),
          tickers: firmographic(params.tickers),
          marketIds: firmographic(params.marketIds),
          marketNames: firmographic(params.marketNames),
          sectorIds: firmographic(params.sectorIds),
          industryIds: firmographic(params.industryIds),
          subindustryIds: firmographic(params.subindustryIds),
          businessModelIds: firmographic(params.businessModelIds),
          technologyIds: firmographic(params.technologyIds),
          collectionIds: firmographic(params.collectionIds),
          countryIds: firmographic(params.countryIds),
          stateProvinceIds: firmographic(params.stateProvinceIds),
          cityIds: firmographic(params.cityIds),
          continentIds: firmographic(params.continentIds),
          regionIds: firmographic(params.regionIds),
          orgStatusIds: firmographic(params.orgStatusIds),
          investorOrgIds: firmographic(params.investorOrgIds),
          investorTypeIds: firmographic(params.investorTypeIds),
          fundingInvestorTypeIds: firmographic(params.fundingInvestorTypeIds),
          lastFundingRoundIds: firmographic(params.lastFundingRoundIds),
          lastFundingRoundCategoryIds: firmographic(params.lastFundingRoundCategoryIds),
          minCurrentHeadcount: firmographic(params.minCurrentHeadcount),
          maxCurrentHeadcount: firmographic(params.maxCurrentHeadcount),
          minTotalFundingInMillions: firmographic(params.minTotalFundingInMillions),
          maxTotalFundingInMillions: firmographic(params.maxTotalFundingInMillions),
          minValuationInMillions: firmographic(params.minValuationInMillions),
          maxValuationInMillions: firmographic(params.maxValuationInMillions),
          minLastFundingDate: firmographic(params.minLastFundingDate),
          maxLastFundingDate: firmographic(params.maxLastFundingDate),
          vcBacked: firmographic(params.vcBacked),
          sortField: firmographic(params.sortField),
          sortDirection: firmographic(params.sortDirection),
          titleIds: hasTitles ? params.titleIds : undefined,
          startDate:
            hasDateRange || operation === 'get_mosaic_history' ? params.startDate : undefined,
          endDate: hasDateRange ? params.endDate : undefined,
          limit: LIMITED_OPERATIONS.includes(operation) ? params.limit : undefined,
          nextPageToken: PAGED_OPERATIONS.includes(operation) ? params.nextPageToken : undefined,
          orgIdFilter: undefined,
          firmographicsUrls: undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'CB Insights operation to perform' },
  },

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Organizations returned by a lookup, firmographics search, or any multi-organization list operation',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page, or null when there are no more results',
    },
    totalHits: {
      type: 'number',
      description: 'Total number of matching records',
    },
    totalHitsRelation: {
      type: 'string',
      description: "Whether totalHits is exact ('eq') or a floor ('gte')",
    },
    fundings: {
      type: 'json',
      description: 'Funding rounds received by a single organization',
    },
    capTableHistory: {
      type: 'json',
      description: "A single organization's cap table history",
    },
    investments: {
      type: 'json',
      description: 'Rounds a single organization invested in',
    },
    portfolioExits: {
      type: 'json',
      description: 'Exits of companies a single organization backed before the exit',
    },
    businessRelationships: {
      type: 'json',
      description: 'Partnerships, client/vendor links, and licensing for a single organization',
    },
    people: {
      type: 'json',
      description: 'Leadership and board members of a single organization',
    },
    mosaicManagement: {
      type: 'number',
      description: 'Management factor of the Mosaic Score',
    },
    mosaicScore: {
      type: 'json',
      description:
        'Current Mosaic Score with its overall, management, market, momentum, and money factors',
    },
    commercialMaturity: {
      type: 'json',
      description: 'Current Commercial Maturity level and the signals behind it',
    },
    exitProbability: {
      type: 'json',
      description: 'Current two-year IPO and M&A exit probabilities',
    },
    overall: {
      type: 'json',
      description: 'Overall Mosaic Score over time',
    },
    management: {
      type: 'json',
      description: 'Mosaic management factor over time',
    },
    market: {
      type: 'json',
      description: 'Mosaic market factor over time',
    },
    momentum: {
      type: 'json',
      description: 'Mosaic momentum factor over time',
    },
    money: {
      type: 'json',
      description: 'Mosaic money factor over time',
    },
    commercialMaturityHistory: {
      type: 'json',
      description: 'Commercial Maturity levels over time',
    },
    ipo: {
      type: 'json',
      description: 'IPO exit probability over time',
    },
    mna: {
      type: 'json',
      description: 'M&A exit probability over time',
    },
    incompleteRoundType: {
      type: 'string',
      description: 'An in-progress round that suppresses the exit probabilities',
    },
    windowStart: {
      type: 'string',
      description: 'Estimated start of the next funding window',
    },
    windowEnd: {
      type: 'string',
      description: 'Estimated end of the next funding window',
    },
    cohortNextRoundRate: {
      type: 'number',
      description: 'Share of the comparison cohort that historically raised another round',
    },
    cohortCriteria: {
      type: 'json',
      description: 'How the comparison cohort was defined',
    },
    latestFunding: {
      type: 'json',
      description: 'The latest equity-backed round used to anchor the funding window',
    },
    revenue: {
      type: 'json',
      description: 'Revenue by calendar year for a single organization',
    },
    orgId: {
      type: 'number',
      description: 'CB Insights organization ID of the returned organization',
    },
    orgName: {
      type: 'string',
      description: 'Name of the returned organization',
    },
    orgUrl: {
      type: 'string',
      description: 'Website of the returned organization',
    },
    logoUrl: {
      type: 'string',
      description: "URL of the organization's logo, returned by Get Strategy Map",
    },
    categories: {
      type: 'json',
      description: 'Strategy map categories with the companies and connections in each',
    },
    orgInfo: {
      type: 'json',
      description: 'Firmographics and proprietary scores accompanying a Scouting Report',
    },
    reportMarkdown: {
      type: 'string',
      description: 'Scouting Report as Markdown, including citations',
    },
    reportJson: {
      type: 'string',
      description: 'Scouting Report as a JSON string, without citation links',
    },
    chatId: {
      type: 'string',
      description: 'ChatCBI conversation ID, to continue the conversation',
    },
    title: {
      type: 'string',
      description: 'Title CB Insights gave the ChatCBI conversation',
    },
    message: {
      type: 'string',
      description: "ChatCBI's answer, as Markdown",
    },
    sources: {
      type: 'json',
      description: 'Sources behind the ChatCBI answer',
    },
    relatedContent: {
      type: 'json',
      description: 'Related references returned alongside a ChatCBI answer',
    },
    suggestions: {
      type: 'json',
      description: 'Suggested follow-up questions from ChatCBI',
    },
    data: {
      type: 'string',
      description: 'Retrieved CB Insights records as a JSON string, returned by Retrieve Context',
    },
    guidance: {
      type: 'json',
      description: 'Notes describing what each retrieved data source contains',
    },
  },
}

export const CbInsightsBlockMeta = {
  tags: ['enrichment', 'data-analytics'],
  url: 'https://www.cbinsights.com',
  skills: [
    {
      name: 'enrich-account-firmographics',
      description:
        'Resolve a company to its CB Insights ID and pull firmographics onto the record. Use to fill in accounts before scoring, routing, or outreach.',
      content:
        '# Enrich Account Firmographics\n\nTurn a company name or domain into a complete CB Insights profile.\n\n## Steps\n1. Run Look Up Organizations on the name or website to get the orgId. This call never charges credits, so resolve first and confirm the match before spending any.\n2. Run Search Firmographics with that orgId to pull the summary, taxonomy, headcount, financials, and identifiers.\n3. Merge the returned fields onto the record, keeping existing values where CB Insights returned nothing.\n\n## Output\nReport the matched orgId and the fields filled. Flag a name that resolved to nothing or matched more than one plausible company.',
    },
    {
      name: 'build-icp-target-list',
      description:
        'Search firmographics against an ideal customer profile and page the full result set into a list. Use for territory and campaign planning.',
      content:
        '# Build ICP Target List\n\nTurn an ICP description into a paged list of matching companies.\n\n## Steps\n1. Translate the ICP into firmographics filters — marketNames or marketIds, sectorIds, countryIds, the headcount range, and the funding or valuation range.\n2. Run Search Firmographics, sorting by mosaicOverall so the strongest companies lead.\n3. Page forward by passing the returned nextPageToken until it comes back null.\n4. Write the deduplicated companies to a table.\n\n## Output\nReport totalHits, how many rows were retrieved, and the filters used. Note when totalHitsRelation is "gte", which means the true total exceeds 10,000.',
    },
    {
      name: 'screen-exit-probability',
      description:
        'Read the outlook for a set of companies and rank them by two-year exit probability against their peer mean. Use for pipeline and portfolio prioritization.',
      content:
        '# Screen Exit Probability\n\nRank companies by how likely they are to exit in the next two years.\n\n## Steps\n1. Run List Outlook for up to 100 orgIds at a time.\n2. For each company read the IPO and M&A probabilities together with meanProbability and ratioToMean — the ratio matters more than the raw number, because it is peer-adjusted.\n3. Note any company whose incompleteRoundType is set: a pending round zeroes every probability, so it is not a real low score.\n4. Rank the remainder and write the screen to a table.\n\n## Output\nReport the ranked companies with both exit types and the peer ratio. List separately the companies excluded for a pending or rumored round.',
    },
    {
      name: 'track-funding-history',
      description:
        'Pull the funding rounds and cap table history of a company and summarize how its terms evolved. Use for diligence and deal prep.',
      content:
        '# Track Funding History\n\nAssemble what a company has raised and on what terms.\n\n## Steps\n1. Resolve the company with Look Up Organizations, then run Get Organization Fundings.\n2. Read the fundings array for round, date, amountInMillions, valuationInMillions, and investors.\n3. Read capTableHistory for issuance and conversion prices, percentage owned, and the terms object — liquidation preference, participation rights, and anti-dilution provision.\n4. Page with nextPageToken until it comes back null.\n\n## Output\nSummarize the round-by-round progression, calling out valuation step-ups or downs and any unusual terms. Say plainly when a value is not published rather than reporting it as zero.',
    },
    {
      name: 'generate-company-brief',
      description:
        'Generate a CB Insights Scouting Report and turn it into a readable brief. Use before a meeting, an investment, or a partnership conversation.',
      content:
        '# Generate Company Brief\n\nProduce a one-page brief on a private company.\n\n## Steps\n1. Resolve the company with Look Up Organizations. Only active companies are eligible for a Scouting Report.\n2. Run Get Scouting Report. Generation can take several minutes — expect the call to be slow rather than treating it as hung.\n3. Use reportMarkdown when citations matter; reportJson omits the citation links.\n4. Pair the report with orgInfo for headcount, funding, Mosaic score, and commercial maturity.\n\n## Output\nReturn the brief with its citations intact. Note that the report is AI-generated and state which claims were not corroborated by the structured fields.',
    },
    {
      name: 'map-competitor-strategy',
      description:
        "Read a competitor's strategy map and summarize where it is partnering, investing, and acquiring. Use for competitive monitoring.",
      content:
        "# Map Competitor Strategy\n\nRead a competitor's posture from who it is connected to.\n\n## Steps\n1. Resolve the competitor with Look Up Organizations, then run Get Strategy Map.\n2. Walk the categories array; within each, read every company and its connections — businessRelationships, investments, and acquisitions.\n3. Group by category to see where the activity concentrates, and read the AI-generated insights attached to each connection.\n\n## Output\nReport the categories ranked by connection count, naming the notable companies in each and whether the tie is a partnership, an investment, or an acquisition.",
    },
    {
      name: 'prune-and-refresh-mirror',
      description:
        'Refresh a mirrored company table from CB Insights in bulk without exhausting credits. Use to keep a local copy current.',
      content:
        '# Prune and Refresh Mirror\n\nKeep a mirrored company table in step with CB Insights.\n\n## Steps\n1. Batch the stored orgIds into groups of 100 — every list endpoint caps there.\n2. Use the multi-organization operations (List Outlook, List Revenue, List Funding Windows) rather than the per-organization ones; one call covers a hundred records.\n3. Note that an organization with no data is omitted from the response rather than returned empty — treat a missing orgId as "no data", not as an error.\n4. Write the refreshed values back, leaving untouched any row the response did not cover.\n\n## Output\nReport how many organizations were requested, how many came back with data, and which were omitted.',
    },
  ],
  templates: [
    {
      icon: CbInsightsIcon,
      title: 'CB Insights account enrichment',
      prompt:
        'Create a workflow that watches my accounts table for new company names, resolves each to a CB Insights organization ID with the free lookup, pulls firmographics and the Mosaic Score, and writes headcount, sector, funding stage, and score back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
    },
    {
      icon: Building,
      title: 'CB Insights ICP company list',
      prompt:
        'Build a workflow that searches CB Insights firmographics for companies matching my ideal customer profile — market, headcount band, funding raised, and headquarters country — pages through every result, and writes the list to a table for the SDR team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: Sprout,
      title: 'CB Insights exit probability watchlist',
      prompt:
        'Create a scheduled workflow that reads the outlook for every company on my watchlist, flags any whose two-year IPO or M&A exit probability moved meaningfully against its peer mean, and posts the changes to Slack.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring', 'finance'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CbInsightsIcon,
      title: 'CB Insights funding window alerts',
      prompt:
        'Build a workflow that checks the estimated funding window for each company in my pipeline every week and emails me the ones entering their window in the next 60 days, with the cohort rate and their last round.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'sales',
      tags: ['sales', 'finance', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: Sparkles,
      title: 'CB Insights scouting report brief',
      prompt:
        'Create an agent that takes a company name, resolves it in CB Insights, generates a Scouting Report, and turns the business model, market position, strengths, and opportunities into a one-page brief I can take into a meeting.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting'],
    },
    {
      icon: Users,
      title: 'CB Insights leadership tracker',
      prompt:
        'Build a workflow that pulls management and board data for my target accounts, extracts each executive with their title, education, and prior roles, and writes the buying committee to a table so reps know who to engage.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'crm'],
    },
    {
      icon: Search,
      title: 'CB Insights competitor strategy map',
      prompt:
        'Create a workflow that takes a competitor, pulls its CB Insights strategy map, and summarizes which categories it is investing in, partnering across, and acquiring into — then posts the summary to my strategy channel.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CbInsightsIcon,
      title: 'CB Insights portfolio exit digest',
      prompt:
        'Build a scheduled workflow that reads portfolio exits for the investors I track, summarizes each exit with the company, round, and amount, and emails a weekly digest to the investment team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'finance', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ListChecks,
      title: 'CB Insights market research agent',
      prompt:
        'Create an agent that answers private-market questions by asking ChatCBI, then verifies the claims against firmographics and funding data before returning an answer with its sources.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'data'],
    },
    {
      icon: Sprout,
      title: 'CB Insights revenue growth screen',
      prompt:
        'Build a workflow that pulls revenue by year for my target list, computes year-over-year growth, ranks the companies by it, and writes the ranked screen to a table with the sources behind each figure.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'finance', 'data'],
    },
  ],
} as const satisfies BlockMeta
