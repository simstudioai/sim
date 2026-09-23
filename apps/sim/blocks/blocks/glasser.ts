import { GlasserIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { GlasserResponse } from '@/tools/glasser/types'

const PEOPLE = 'glasser_people_search'
const COMPANY = 'glasser_company_intelligence'
const SEO = 'glasser_seo_research'
const WEB = 'glasser_web_research'
const SOCIAL = 'glasser_social_research'
const MARKET = 'glasser_market_data'

const AUTO_PROVIDER = { label: 'Auto (Glasser picks)', id: 'auto' }

/** Providers each capability can route to; `auto` picks the first preferred one the key may run. */
const PROVIDERS_BY_OPERATION: Record<string, { label: string; id: string }[]> = {
  [PEOPLE]: [
    AUTO_PROVIDER,
    { label: 'Apollo', id: 'apollo' },
    { label: 'People Data Labs', id: 'pdl' },
    { label: 'LeadMagic', id: 'leadmagic' },
    { label: 'ZoomInfo', id: 'zoominfo' },
    { label: 'Hunter', id: 'hunter' },
    { label: 'Prospeo', id: 'prospeo' },
  ],
  [COMPANY]: [
    AUTO_PROVIDER,
    { label: 'Apollo', id: 'apollo' },
    { label: 'People Data Labs', id: 'pdl' },
    { label: 'Hunter', id: 'hunter' },
    { label: 'Prospeo', id: 'prospeo' },
    { label: 'PredictLeads', id: 'predictleads' },
    { label: 'LeadMagic', id: 'leadmagic' },
    { label: 'BuiltWith', id: 'builtwith' },
    { label: 'DataForSEO', id: 'dataforseo' },
    { label: 'Ahrefs', id: 'ahrefs' },
    { label: 'Apify', id: 'apify' },
    { label: 'Exa', id: 'exa' },
    { label: 'Serper', id: 'serper' },
  ],
  [SEO]: [
    AUTO_PROVIDER,
    { label: 'Semrush', id: 'semrush' },
    { label: 'Serpstat', id: 'serpstat' },
    { label: 'DataForSEO', id: 'dataforseo' },
    { label: 'Ahrefs', id: 'ahrefs' },
    { label: 'Serper', id: 'serper' },
  ],
  [WEB]: [
    AUTO_PROVIDER,
    { label: 'Serper', id: 'serper' },
    { label: 'SerpApi', id: 'serpapi' },
    { label: 'Exa', id: 'exa' },
    { label: 'DataForSEO', id: 'dataforseo' },
  ],
  [SOCIAL]: [
    AUTO_PROVIDER,
    { label: 'ScrapeCreators', id: 'scrapecreators' },
    { label: 'Apify', id: 'apify' },
    { label: 'TikHub', id: 'tikhub' },
    { label: 'People Data Labs', id: 'pdl' },
  ],
  [MARKET]: [
    AUTO_PROVIDER,
    { label: 'RentCast', id: 'rentcast' },
    { label: 'SerpApi', id: 'serpapi' },
  ],
}

/** Sub-blocks whose id differs from the API field they feed. */
const ID_TO_PARAM: Record<string, string> = {
  ps_keywords: 'keywords',
  seo_keywords: 'keywords',
  ci_query: 'query',
  sr_platform: 'platform',
  sr_mode: 'mode',
  sr_query: 'query',
  sr_url: 'url',
}

/** Per operation, the sub-block that carries the API's `action`. */
const ACTION_FIELD: Record<string, string> = {
  [PEOPLE]: 'ps_action',
  [COMPANY]: 'ci_action',
  [SEO]: 'seo_action',
  [WEB]: 'wr_action',
  [MARKET]: 'md_action',
}

const SHARED_FIELDS = ['provider', 'task_id', 'apiKey'] as const

/**
 * Sub-blocks each operation owns. Values of the other operations stay stored on the block after
 * switching, so only these are folded and every other API field is cleared explicitly.
 */
const OPERATION_FIELDS: Record<string, readonly string[]> = {
  [PEOPLE]: [
    'ps_action',
    'job_titles',
    'seniorities',
    'locations',
    'company_domain',
    'ps_keywords',
    'full_name',
    'email',
    'linkedin_url',
    'limit',
  ],
  [COMPANY]: ['ci_action', 'domain', 'ci_query', 'country', 'limit'],
  [SEO]: ['seo_action', 'seo_keywords', 'domain', 'country', 'limit'],
  [WEB]: ['wr_action', 'query', 'url', 'country', 'language', 'limit'],
  [SOCIAL]: ['sr_platform', 'sr_mode', 'sr_query', 'sr_url', 'handle'],
  [MARKET]: ['md_action', 'address', 'city', 'state', 'zip', 'symbol', 'limit'],
}

/** Every API field any operation can send; cleared before the selected operation's fields are folded. */
const ALL_PARAM_NAMES = Array.from(
  new Set(
    Object.values(OPERATION_FIELDS)
      .flat()
      .map((id) => (Object.values(ACTION_FIELD).includes(id) ? 'action' : (ID_TO_PARAM[id] ?? id)))
  )
)

export const GlasserBlock: BlockConfig<GlasserResponse> = {
  type: 'glasser',
  name: 'Glasser',
  description: 'People, company, SEO, web, social and market data through one key',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Glasser into the workflow. Find prospects and enrich people, get company intelligence from a domain, research keywords, backlinks and rankings, search the web, news and places or read a page, search social media, and read US property data and stock quotes. One key covers every provider; Glasser routes each call, falls back on provider errors, and returns the provider-native result with its exact charge.',
  docsLink: 'https://docs.sim.ai/integrations/glasser',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: GlasserIcon,
  canvasPresentation: {
    defaultTitle: 'Glasser',
    sentences: {
      byOperation: {
        [PEOPLE]: [
          'Find or enrich people',
          { text: 'titled', field: 'job_titles' },
          { text: 'at', field: 'company_domain' },
          { text: 'named', field: 'full_name' },
        ],
        [COMPANY]: [
          { text: 'Get', field: 'ci_action', core: true },
          { text: 'for', field: 'domain', core: true },
        ],
        [SEO]: [
          { text: 'Get', field: 'seo_action', core: true },
          { text: 'for', field: ['seo_keywords', 'domain'] },
        ],
        [WEB]: ['Research the web', { text: 'for', field: 'query' }, { text: 'at', field: 'url' }],
        [SOCIAL]: [
          { text: 'Get', field: 'sr_mode', core: true },
          { text: 'on', field: 'sr_platform', core: true },
          { text: 'for', field: ['sr_query', 'handle', 'sr_url'] },
        ],
        [MARKET]: [
          { text: 'Get', field: 'md_action', core: true },
          { text: 'for', field: ['address', 'zip', 'symbol', 'city'] },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Prospects', id: PEOPLE },
        { label: 'Company Intelligence', id: COMPANY },
        { label: 'Keywords and SEO', id: SEO },
        { label: 'Web Research', id: WEB },
        { label: 'Social Media Search', id: SOCIAL },
        { label: 'Market Data', id: MARKET },
      ],
      value: () => PEOPLE,
    },

    {
      id: 'ps_action',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'Enrich', id: 'enrich' },
        { label: 'Find Work Email', id: 'find_email' },
      ],
      value: () => 'search',
      condition: { field: 'operation', value: PEOPLE },
    },
    {
      id: 'job_titles',
      title: 'Job Titles',
      type: 'short-input',
      placeholder: 'CTO, VP Engineering',
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'search' },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of job titles to search for. Return ONLY the list, no explanations.',
        placeholder: 'Describe the roles, e.g. "engineering leaders"',
      },
    },
    {
      id: 'seniorities',
      title: 'Seniorities',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Owner', id: 'owner' },
        { label: 'Founder', id: 'founder' },
        { label: 'C-suite', id: 'c_suite' },
        { label: 'Partner', id: 'partner' },
        { label: 'VP', id: 'vp' },
        { label: 'Head', id: 'head' },
        { label: 'Director', id: 'director' },
        { label: 'Manager', id: 'manager' },
        { label: 'Senior', id: 'senior' },
        { label: 'Entry', id: 'entry' },
        { label: 'Intern', id: 'intern' },
      ],
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'search' },
      },
      mode: 'advanced',
    },
    {
      id: 'locations',
      title: 'Locations',
      type: 'short-input',
      placeholder: 'San Francisco, Germany',
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'search' },
      },
    },
    {
      id: 'company_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: PEOPLE },
      required: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'find_email' },
      },
    },
    {
      id: 'ps_keywords',
      title: 'Keywords',
      type: 'short-input',
      placeholder: 'Free-text keywords to match against profiles',
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'search' },
      },
      mode: 'advanced',
    },
    {
      id: 'full_name',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Patrick Collison',
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: ['enrich', 'find_email'] },
      },
      required: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'find_email' },
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'patrick@stripe.com',
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'enrich' },
      },
    },
    {
      id: 'linkedin_url',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/patrickcollison',
      condition: {
        field: 'operation',
        value: PEOPLE,
        and: { field: 'ps_action', value: 'enrich' },
      },
    },

    {
      id: 'ci_action',
      title: 'Company Report',
      type: 'dropdown',
      options: [
        { label: 'Profile', id: 'enrich' },
        { label: 'Tech Stack', id: 'tech_stack' },
        { label: 'Traffic', id: 'traffic' },
        { label: 'Competitors', id: 'competitors' },
        { label: 'Funding', id: 'funding' },
        { label: 'News', id: 'news' },
      ],
      value: () => 'enrich',
      condition: { field: 'operation', value: COMPANY },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: [COMPANY, SEO] },
      required: { field: 'operation', value: COMPANY },
    },
    {
      id: 'ci_query',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'For news only: search Google News by name instead of domain',
      condition: { field: 'operation', value: COMPANY, and: { field: 'ci_action', value: 'news' } },
      mode: 'advanced',
    },

    {
      id: 'seo_action',
      title: 'SEO Report',
      canvasNoun: 'an SEO report',
      type: 'dropdown',
      options: [
        { label: 'Keyword Overview', id: 'keyword_overview' },
        { label: 'Keyword Ideas', id: 'keyword_ideas' },
        { label: 'Google Results', id: 'serp' },
        { label: 'Domain Overview', id: 'domain_overview' },
        { label: 'Ranked Keywords', id: 'ranked_keywords' },
        { label: 'Organic Competitors', id: 'organic_competitors' },
        { label: 'Backlinks Overview', id: 'backlinks_overview' },
        { label: 'Backlinks', id: 'backlinks' },
        { label: 'Referring Domains', id: 'referring_domains' },
        { label: 'Domain Rating', id: 'domain_rating' },
      ],
      value: () => 'keyword_overview',
      condition: { field: 'operation', value: SEO },
    },
    {
      id: 'seo_keywords',
      title: 'Keywords',
      type: 'short-input',
      placeholder: 'ai agents, workflow automation',
      condition: {
        field: 'operation',
        value: SEO,
        and: { field: 'seo_action', value: ['keyword_overview', 'keyword_ideas', 'serp'] },
      },
      required: {
        field: 'operation',
        value: SEO,
        and: { field: 'seo_action', value: ['keyword_overview', 'keyword_ideas', 'serp'] },
      },
    },

    {
      id: 'wr_action',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'News', id: 'news' },
        { label: 'Places', id: 'places' },
        { label: 'Scholar', id: 'scholar' },
        { label: 'Shopping', id: 'shopping' },
        { label: 'Images', id: 'images' },
        { label: 'Videos', id: 'videos' },
        { label: 'Answer', id: 'answer' },
        { label: 'Scrape', id: 'scrape' },
        { label: 'Similar', id: 'similar' },
      ],
      value: () => 'search',
      condition: { field: 'operation', value: WEB },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'Search phrase or question',
      condition: {
        field: 'operation',
        value: WEB,
        and: { field: 'wr_action', value: ['scrape', 'similar'], not: true },
      },
      required: {
        field: 'operation',
        value: WEB,
        and: { field: 'wr_action', value: ['scrape', 'similar'], not: true },
      },
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://example.com/page',
      condition: {
        field: 'operation',
        value: WEB,
        and: { field: 'wr_action', value: ['scrape', 'similar'] },
      },
      required: {
        field: 'operation',
        value: WEB,
        and: { field: 'wr_action', value: ['scrape', 'similar'] },
      },
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      condition: { field: 'operation', value: WEB },
      mode: 'advanced',
    },

    {
      id: 'sr_platform',
      title: 'Platform',
      type: 'dropdown',
      options: [
        { label: 'Reddit', id: 'reddit' },
        { label: 'X', id: 'x' },
        { label: 'YouTube', id: 'youtube' },
        { label: 'TikTok', id: 'tiktok' },
        { label: 'Instagram', id: 'instagram' },
        { label: 'LinkedIn', id: 'linkedin' },
      ],
      value: () => 'reddit',
      condition: { field: 'operation', value: SOCIAL },
      required: { field: 'operation', value: SOCIAL },
    },
    {
      id: 'sr_mode',
      title: 'Content',
      type: 'dropdown',
      options: [
        { label: 'Posts Matching a Query', id: 'search' },
        { label: 'Profile', id: 'profile' },
        { label: 'Recent Posts', id: 'feed' },
        { label: 'One Post', id: 'post' },
        { label: 'Other Profiles', id: 'find' },
      ],
      value: () => 'search',
      condition: { field: 'operation', value: SOCIAL },
    },
    {
      id: 'sr_query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'Search phrase',
      condition: {
        field: 'operation',
        value: SOCIAL,
        and: { field: 'sr_mode', value: ['search', 'find'] },
      },
      required: { field: 'operation', value: SOCIAL, and: { field: 'sr_mode', value: 'search' } },
    },
    {
      id: 'sr_url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'Post URL, or a LinkedIn profile or company page URL',
      condition: {
        field: 'operation',
        value: SOCIAL,
        and: { field: 'sr_mode', value: 'search', not: true },
      },
      required: { field: 'operation', value: SOCIAL, and: { field: 'sr_mode', value: 'post' } },
    },
    {
      id: 'handle',
      title: 'Handle',
      type: 'short-input',
      placeholder: 'Username without @, or subreddit without r/',
      condition: {
        field: 'operation',
        value: SOCIAL,
        and: { field: 'sr_mode', value: ['profile', 'feed', 'find'] },
      },
    },

    {
      id: 'md_action',
      title: 'Market Report',
      type: 'dropdown',
      options: [
        { label: 'Property Value', id: 'property_value' },
        { label: 'Rent Estimate', id: 'property_rent' },
        { label: 'Property Records', id: 'property_search' },
        { label: 'Sale Listings', id: 'listings_sale' },
        { label: 'Rental Listings', id: 'listings_rental' },
        { label: 'ZIP Market Stats', id: 'market_stats' },
        { label: 'Stock Quote', id: 'stock_quote' },
      ],
      value: () => 'property_value',
      condition: { field: 'operation', value: MARKET },
      required: { field: 'operation', value: MARKET },
    },
    {
      id: 'address',
      title: 'Address',
      type: 'short-input',
      placeholder: '5500 Grand Lake Dr, San Antonio, TX 78244',
      condition: {
        field: 'operation',
        value: MARKET,
        and: {
          field: 'md_action',
          value: [
            'property_value',
            'property_rent',
            'property_search',
            'listings_sale',
            'listings_rental',
          ],
        },
      },
      required: {
        field: 'operation',
        value: MARKET,
        and: { field: 'md_action', value: ['property_value', 'property_rent'] },
      },
    },
    {
      id: 'city',
      title: 'City',
      type: 'short-input',
      placeholder: 'Austin',
      condition: {
        field: 'operation',
        value: MARKET,
        and: { field: 'md_action', value: ['property_search', 'listings_sale', 'listings_rental'] },
      },
      mode: 'advanced',
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      placeholder: 'TX',
      condition: {
        field: 'operation',
        value: MARKET,
        and: { field: 'md_action', value: ['property_search', 'listings_sale', 'listings_rental'] },
      },
      mode: 'advanced',
    },
    {
      id: 'zip',
      title: 'ZIP Code',
      type: 'short-input',
      placeholder: '78244',
      condition: {
        field: 'operation',
        value: MARKET,
        and: {
          field: 'md_action',
          value: ['property_search', 'listings_sale', 'listings_rental', 'market_stats'],
        },
      },
      required: {
        field: 'operation',
        value: MARKET,
        and: { field: 'md_action', value: 'market_stats' },
      },
    },
    {
      id: 'symbol',
      title: 'Symbol',
      type: 'short-input',
      placeholder: 'AAPL:NASDAQ',
      condition: {
        field: 'operation',
        value: MARKET,
        and: { field: 'md_action', value: 'stock_quote' },
      },
      required: {
        field: 'operation',
        value: MARKET,
        and: { field: 'md_action', value: 'stock_quote' },
      },
    },

    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'us',
      condition: { field: 'operation', value: [COMPANY, SEO, WEB] },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Rows to return, 1-100',
      condition: { field: 'operation', value: SOCIAL, not: true },
      mode: 'advanced',
    },
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: (params) =>
        PROVIDERS_BY_OPERATION[String(params?.values.operation ?? PEOPLE)] ?? [AUTO_PROVIDER],
      value: () => 'auto',
      mode: 'advanced',
    },
    {
      id: 'task_id',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Any stable string that groups the runs of one piece of work',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Glasser API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [PEOPLE, COMPANY, SEO, WEB, SOCIAL, MARKET],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const operation = String(params.operation ?? PEOPLE)
        const actionField = ACTION_FIELD[operation]
        const result: Record<string, unknown> = {}
        for (const name of ALL_PARAM_NAMES) result[name] = undefined

        for (const id of [...(OPERATION_FIELDS[operation] ?? []), ...SHARED_FIELDS]) {
          const value = params[id]
          if (value === undefined || value === null || value === '') continue
          const paramName = id === actionField ? 'action' : (ID_TO_PARAM[id] ?? id)
          if (paramName === 'limit') {
            result.limit = Number(value)
          } else if (Array.isArray(value)) {
            result[paramName] = value.join(',')
          } else {
            result[paramName] = value
          }
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Glasser API key' },
    provider: { type: 'string', description: 'Data provider, auto by default' },
    task_id: { type: 'string', description: 'Task the runs are filed under' },
    limit: { type: 'number', description: 'Rows to return' },
    country: { type: 'string', description: 'Country as ISO code or name' },
    ps_action: { type: 'string', description: 'search, enrich or find_email' },
    job_titles: { type: 'string', description: 'Job titles, comma-separated' },
    seniorities: { type: 'json', description: 'Seniority levels' },
    locations: { type: 'string', description: 'Locations, comma-separated' },
    company_domain: { type: 'string', description: 'Employer domain' },
    ps_keywords: { type: 'string', description: 'Profile keywords' },
    full_name: { type: 'string', description: "Person's full name" },
    email: { type: 'string', description: 'Email address' },
    linkedin_url: { type: 'string', description: 'LinkedIn profile URL' },
    ci_action: { type: 'string', description: 'Company report to fetch' },
    domain: { type: 'string', description: 'Website domain' },
    ci_query: { type: 'string', description: 'Company name for news search' },
    seo_action: { type: 'string', description: 'SEO report to fetch' },
    seo_keywords: { type: 'string', description: 'Keywords, comma-separated' },
    wr_action: { type: 'string', description: 'Web research action' },
    query: { type: 'string', description: 'Search phrase or question' },
    url: { type: 'string', description: 'Page URL' },
    language: { type: 'string', description: 'Two-letter language code' },
    sr_platform: { type: 'string', description: 'Social platform' },
    sr_mode: { type: 'string', description: 'What to read on the platform' },
    sr_query: { type: 'string', description: 'Search phrase (social)' },
    sr_url: { type: 'string', description: 'Post, profile or company page URL (social)' },
    handle: { type: 'string', description: 'Username or subreddit' },
    md_action: { type: 'string', description: 'Market report to fetch' },
    address: { type: 'string', description: 'US street address' },
    city: { type: 'string', description: 'US city' },
    state: { type: 'string', description: 'Two-letter US state code' },
    zip: { type: 'string', description: 'Five-digit US ZIP code' },
    symbol: { type: 'string', description: 'Ticker with exchange' },
  },

  outputs: {
    id: { type: 'string', description: 'Run ID' },
    run_url: { type: 'string', description: 'Link to the run in the Glasser console' },
    status: { type: 'string', description: 'COMPLETED, FAILED or STOPPED' },
    provider: { type: 'string', description: 'Data provider that served the call' },
    endpoint: { type: 'string', description: 'Provider endpoint that served the call' },
    output: {
      type: 'json',
      description: 'Provider-native result; its shape depends on provider and endpoint',
    },
    charge_usd: { type: 'string', description: 'Exact USD charge as a decimal string' },
    failure: { type: 'json', description: 'Failure (kind, message) or null' },
    task_id: { type: 'string', description: 'Task the run was filed under' },
  },
}

export const GlasserBlockMeta = {
  tags: ['enrichment', 'seo', 'web-scraping'],
  url: 'https://glasser.ai',
  templates: [
    {
      icon: GlasserIcon,
      title: 'Glasser prospect list builder',
      prompt:
        'Build a workflow that takes an ideal customer profile (titles, seniority, locations), runs Glasser Find Prospects, and writes each contact with a found work email into a prospects table.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser inbound lead enricher',
      prompt:
        'Create a workflow that, when a form submission arrives with a work email, runs Glasser Find Prospects to enrich the person and Company Intelligence on their domain, then creates the lead in the CRM with firmographics filled in.',
      modules: ['workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser account research brief',
      prompt:
        'Build an agent that takes a company domain, calls Glasser Company Intelligence for the profile, tech stack, funding and news, and writes a one-page account brief for the sales rep.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser weekly SEO report',
      prompt:
        'Create a scheduled weekly workflow that runs Glasser Keywords and SEO for the domain overview, ranked keywords and backlinks overview, compares them with last week in a table, and posts the changes to Slack.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser keyword opportunity finder',
      prompt:
        'Build a workflow that takes a seed keyword, runs Glasser Keywords and SEO for keyword ideas and the Google results, has an agent pick the terms with high volume and low difficulty, and saves them to a content backlog table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser competitor news monitor',
      prompt:
        'Create a scheduled daily workflow that runs Glasser Web Research news searches for each competitor in a table, has an agent summarize what is new, and emails a digest.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser social listening agent',
      prompt:
        'Build a scheduled workflow that runs Glasser Social Media Search on Reddit and X for a product name, has an agent flag posts that ask for help or compare alternatives, and logs them to a table for the community team.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: GlasserIcon,
      title: 'Glasser property valuation lookup',
      prompt:
        'Create a workflow that takes a US address, runs Glasser Market Data for the property value and rent estimate, and returns both with the ZIP-code market statistics.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['research'],
    },
  ],
  skills: [
    {
      name: 'build-prospect-list',
      description:
        'Find decision makers matching an ideal customer profile with Glasser Find Prospects and return them with work emails.',
      content:
        '# Build Prospect List\n\nTurn an ideal customer profile into a list of contacts.\n\n## Steps\n1. Set the operation to Find Prospects with the Search action.\n2. Enter job titles, seniorities and locations that describe the buyer; add a company domain to target one account.\n3. Keep the limit small and run; review the returned people.\n4. For each person without an email, run Find Work Email with their full name and company domain.\n\n## Output\nA list of contacts with name, title, company and work email, plus the provider and charge for each call.',
    },
    {
      name: 'enrich-company-from-domain',
      description:
        'Get a company profile, tech stack, funding and news from its domain with Glasser Company Intelligence.',
      content:
        '# Enrich Company From Domain\n\nBuild a full picture of an account from its website domain.\n\n## Steps\n1. Set the operation to Company Intelligence and enter the domain.\n2. Run the Profile report for firmographics.\n3. Run Tech Stack, Funding and News as needed; each is one call with its own charge.\n4. Combine the reports into one summary.\n\n## Output\nFirmographics, technologies, funding rounds and recent news for the company, with the provider that served each report.',
    },
    {
      name: 'research-keywords',
      description:
        'Check search volume and difficulty for keywords and find related ideas with Glasser Keywords and SEO.',
      content:
        '# Research Keywords\n\nSize a topic before writing content.\n\n## Steps\n1. Set the operation to Keywords and SEO with the Keyword Overview report and enter up to 20 keywords.\n2. Set the country if the audience is not in the US.\n3. For the strongest keyword, run Keyword Ideas to expand it and Google Results to see who ranks.\n4. Rank the terms by volume against difficulty.\n\n## Output\nA table of keywords with volume, difficulty and the pages that currently rank.',
    },
    {
      name: 'monitor-brand-mentions',
      description:
        'Find recent news and social posts that mention a brand or competitor with Glasser Web Research and Social Media Search.',
      content:
        '# Monitor Brand Mentions\n\nTrack what is being said about a brand.\n\n## Steps\n1. Set the operation to Web Research with the News action and the brand name as the query.\n2. Set the operation to Social Media Search, choose a platform, and search posts for the same name.\n3. Filter the results to mentions that are new since the last run.\n4. Summarize each mention with its source URL.\n\n## Output\nA list of new mentions with source, date and a one-line summary.',
    },
  ],
} as const satisfies BlockMeta
