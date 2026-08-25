import { SemrushIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SemrushResponse } from '@/tools/semrush/types'

const DATABASE_OPTIONS = [
  { label: 'United States (us)', id: 'us' },
  { label: 'United Kingdom (uk)', id: 'uk' },
  { label: 'Canada (ca)', id: 'ca' },
  { label: 'Australia (au)', id: 'au' },
  { label: 'Germany (de)', id: 'de' },
  { label: 'France (fr)', id: 'fr' },
  { label: 'Spain (es)', id: 'es' },
  { label: 'Italy (it)', id: 'it' },
  { label: 'Netherlands (nl)', id: 'nl' },
  { label: 'Brazil (br)', id: 'br' },
  { label: 'Mexico (mx)', id: 'mx' },
  { label: 'India (in)', id: 'in' },
  { label: 'Japan (jp)', id: 'jp' },
]

const TARGET_TYPE_OPTIONS = [
  { label: 'Root domain (including subdomains)', id: 'root_domain' },
  { label: 'Exact domain or subdomain', id: 'domain' },
  { label: 'Exact URL', id: 'url' },
]

const COMPETITION_TYPE_OPTIONS = [
  { label: 'Organic keywords', id: 'or' },
  { label: 'Paid keywords', id: 'ad' },
]

/**
 * Operation sets, kept in lockstep with the tool each one selects. A field is
 * shown exactly for the operations whose tool declares the matching param.
 */
const OPERATIONS = [
  'semrush_domain_overview',
  'semrush_domain_overview_all',
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_domain_pla_keywords',
  'semrush_domain_pla_copies',
  'semrush_domain_vs_domain',
  'semrush_subdomain_overview',
  'semrush_subdomain_overview_all',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
  'semrush_url_overview',
  'semrush_url_overview_all',
  'semrush_url_overview_history',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_keyword_overview',
  'semrush_keyword_overview_all',
  'semrush_batch_keyword_overview',
  'semrush_keyword_difficulty',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_organic_results',
  'semrush_paid_results',
  'semrush_keyword_ad_history',
  'semrush_winners_and_losers',
  'semrush_top_domains',
  'semrush_backlinks_overview',
  'semrush_backlinks',
  'semrush_referring_domains',
  'semrush_referring_ips',
  'semrush_backlinks_tld_distribution',
  'semrush_backlinks_geo_distribution',
  'semrush_backlinks_anchors',
  'semrush_backlinks_indexed_pages',
  'semrush_backlinks_competitors',
]

const DOMAIN_OPERATIONS = [
  'semrush_domain_overview',
  'semrush_domain_overview_all',
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_domain_pla_keywords',
  'semrush_domain_pla_copies',
]

const SUBDOMAIN_OPERATIONS = [
  'semrush_subdomain_overview',
  'semrush_subdomain_overview_all',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
]

const URL_OPERATIONS = [
  'semrush_url_overview',
  'semrush_url_overview_all',
  'semrush_url_overview_history',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
]

const PHRASE_OPERATIONS = [
  'semrush_keyword_overview',
  'semrush_keyword_overview_all',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_organic_results',
  'semrush_paid_results',
  'semrush_keyword_ad_history',
]

const PHRASES_OPERATIONS = ['semrush_batch_keyword_overview', 'semrush_keyword_difficulty']

const DOMAINS_OPERATIONS = ['semrush_domain_vs_domain']

const TARGET_OPERATIONS = [
  'semrush_backlinks_overview',
  'semrush_backlinks',
  'semrush_referring_domains',
  'semrush_referring_ips',
  'semrush_backlinks_tld_distribution',
  'semrush_backlinks_geo_distribution',
  'semrush_backlinks_anchors',
  'semrush_backlinks_indexed_pages',
  'semrush_backlinks_competitors',
]

const DATABASE_OPERATIONS = [
  'semrush_domain_overview',
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_domain_pla_keywords',
  'semrush_domain_pla_copies',
  'semrush_domain_vs_domain',
  'semrush_subdomain_overview',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
  'semrush_url_overview',
  'semrush_url_overview_history',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_keyword_overview',
  'semrush_batch_keyword_overview',
  'semrush_keyword_difficulty',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_organic_results',
  'semrush_paid_results',
  'semrush_keyword_ad_history',
  'semrush_winners_and_losers',
  'semrush_top_domains',
  'semrush_domain_overview_all',
  'semrush_subdomain_overview_all',
  'semrush_url_overview_all',
  'semrush_keyword_overview_all',
]

const DATABASE_REQUIRED_OPERATIONS = [
  'semrush_domain_overview',
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_domain_pla_keywords',
  'semrush_domain_pla_copies',
  'semrush_domain_vs_domain',
  'semrush_subdomain_overview',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
  'semrush_url_overview',
  'semrush_url_overview_history',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_keyword_overview',
  'semrush_batch_keyword_overview',
  'semrush_keyword_difficulty',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_organic_results',
  'semrush_paid_results',
  'semrush_keyword_ad_history',
  'semrush_winners_and_losers',
  'semrush_top_domains',
]

const PAGED_OPERATIONS = [
  'semrush_domain_overview_all',
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_domain_pla_keywords',
  'semrush_domain_pla_copies',
  'semrush_domain_vs_domain',
  'semrush_subdomain_overview_all',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
  'semrush_url_overview_all',
  'semrush_url_overview_history',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_organic_results',
  'semrush_paid_results',
  'semrush_keyword_ad_history',
  'semrush_winners_and_losers',
  'semrush_top_domains',
  'semrush_backlinks',
  'semrush_referring_domains',
  'semrush_referring_ips',
  'semrush_backlinks_tld_distribution',
  'semrush_backlinks_geo_distribution',
  'semrush_backlinks_anchors',
  'semrush_backlinks_indexed_pages',
  'semrush_backlinks_competitors',
]

const HISTORICAL_DATE_OPERATIONS = [
  'semrush_domain_overview',
  'semrush_domain_overview_all',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_subdomain_overview',
  'semrush_subdomain_overview_all',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_url_overview',
  'semrush_url_overview_all',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_keyword_overview',
  'semrush_batch_keyword_overview',
  'semrush_organic_results',
  'semrush_paid_results',
  'semrush_winners_and_losers',
  'semrush_top_domains',
]

const DAILY_OPERATIONS = [
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_url_overview_history',
]

const SORTABLE_OPERATIONS = [
  'semrush_domain_overview_all',
  'semrush_domain_overview_history',
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_organic_competitors',
  'semrush_domain_paid_competitors',
  'semrush_domain_pla_keywords',
  'semrush_domain_vs_domain',
  'semrush_subdomain_overview_all',
  'semrush_subdomain_overview_history',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
  'semrush_url_overview_all',
  'semrush_url_overview_history',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_winners_and_losers',
  'semrush_backlinks',
  'semrush_referring_domains',
  'semrush_referring_ips',
  'semrush_backlinks_tld_distribution',
  'semrush_backlinks_geo_distribution',
  'semrush_backlinks_anchors',
  'semrush_backlinks_indexed_pages',
]

const FILTERABLE_OPERATIONS = [
  'semrush_domain_organic_keywords',
  'semrush_domain_paid_keywords',
  'semrush_domain_ad_copies',
  'semrush_domain_ad_history',
  'semrush_domain_pla_keywords',
  'semrush_domain_vs_domain',
  'semrush_subdomain_organic_keywords',
  'semrush_subdomain_paid_keywords',
  'semrush_subdomain_ad_copies',
  'semrush_url_organic_keywords',
  'semrush_url_paid_keywords',
  'semrush_related_keywords',
  'semrush_broad_match_keywords',
  'semrush_keyword_questions',
  'semrush_top_domains',
  'semrush_backlinks',
  'semrush_referring_domains',
]

const DISPLAY_DATE_WAND_CONFIG = {
  enabled: true,
  prompt: `Generate a Semrush display_date value in YYYYMM15 format based on the description.
Examples:
- "last month" -> the previous month in YYYYMM15 format
- "January 2026" -> 20260115
- "a year ago" -> the same month one year back in YYYYMM15 format

Return ONLY the 8-character value - no explanations, no quotes, no extra text.`,
  placeholder: 'Describe the month (e.g., "last month", "January 2026")...',
  generationType: 'timestamp' as const,
}

export const SemrushBlock: BlockConfig<SemrushResponse> = {
  type: 'semrush',
  name: 'Semrush',
  description: 'Research SEO and paid search data with Semrush',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Query the Semrush SEO API for domain, subdomain, and URL traffic overviews, organic and paid keywords, ad and product listing creatives, competitor sets, keyword research, and backlink profiles. Requires a Semrush subscription with API units.',
  docsLink: 'https://docs.sim.ai/integrations/semrush',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: SemrushIcon,
  canvasPresentation: {
    defaultTitle: 'Semrush',
    operationSubBlockId: 'operation',
    sentences: {
      byOperation: {
        semrush_domain_overview: [
          { text: 'Read the search overview for', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_overview_all: [
          {
            text: 'Read the search overview across every database for',
            field: 'domain',
            core: true,
          },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_overview_history: [
          { text: 'Read the search overview history for', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_organic_keywords: [
          { text: 'List organic keywords for', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_paid_keywords: [
          { text: 'List paid keywords for', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_ad_copies: [
          { text: 'List the ad copies run by', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_ad_history: [
          { text: 'Read the ad history of', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_organic_competitors: [
          { text: 'List organic search competitors of', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_paid_competitors: [
          { text: 'List paid search competitors of', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_pla_keywords: [
          { text: 'List product listing ad keywords for', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_pla_copies: [
          { text: 'List the product listing ads run by', field: 'domain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_domain_vs_domain: [
          { text: 'Compare keyword positions across', field: 'domains', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_subdomain_overview: [
          { text: 'Read the search overview for', field: 'subdomain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_subdomain_overview_all: [
          {
            text: 'Read the search overview across every database for',
            field: 'subdomain',
            core: true,
          },
          { text: ', in', field: 'database' },
        ],
        semrush_subdomain_overview_history: [
          { text: 'Read the search overview history for', field: 'subdomain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_subdomain_organic_keywords: [
          { text: 'List organic keywords for', field: 'subdomain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_subdomain_paid_keywords: [
          { text: 'List paid keywords for', field: 'subdomain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_subdomain_ad_copies: [
          { text: 'List the ad copies run by', field: 'subdomain', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_url_overview: [
          { text: 'Read the search overview for', field: 'url', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_url_overview_all: [
          { text: 'Read the search overview across every database for', field: 'url', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_url_overview_history: [
          { text: 'Read the search overview history for', field: 'url', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_url_organic_keywords: [
          { text: 'List organic keywords for', field: 'url', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_url_paid_keywords: [
          { text: 'List paid keywords for', field: 'url', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_keyword_overview: [
          { text: 'Read keyword metrics for', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_keyword_overview_all: [
          { text: 'Read keyword metrics across every database for', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_batch_keyword_overview: [
          { text: 'Read keyword metrics for', field: 'phrases', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_keyword_difficulty: [
          { text: 'Read keyword difficulty for', field: 'phrases', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_related_keywords: [
          { text: 'Find keywords related to', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_broad_match_keywords: [
          { text: 'Find broad match variations of', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_keyword_questions: [
          { text: 'Find question keywords containing', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_organic_results: [
          { text: 'List the pages ranking for', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_paid_results: [
          { text: 'List the advertisers bidding on', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_keyword_ad_history: [
          { text: 'Read the ad history of', field: 'phrase', core: true },
          { text: ', in', field: 'database' },
        ],
        semrush_winners_and_losers: [
          {
            text: 'List the biggest visibility gains and losses in',
            field: 'database',
            core: true,
          },
        ],
        semrush_top_domains: [
          { text: 'List the highest-ranked domains in', field: 'database', core: true },
        ],
        semrush_backlinks_overview: [
          { text: 'Read the backlink profile totals for', field: 'target', core: true },
        ],
        semrush_backlinks: [{ text: 'List backlinks pointing to', field: 'target', core: true }],
        semrush_referring_domains: [
          { text: 'List the domains linking to', field: 'target', core: true },
        ],
        semrush_referring_ips: [
          { text: 'List the IP addresses linking to', field: 'target', core: true },
        ],
        semrush_backlinks_tld_distribution: [
          {
            text: 'Break down referring domains by top-level domain for',
            field: 'target',
            core: true,
          },
        ],
        semrush_backlinks_geo_distribution: [
          { text: 'Break down referring domains by country for', field: 'target', core: true },
        ],
        semrush_backlinks_anchors: [
          { text: 'List the backlink anchor texts for', field: 'target', core: true },
        ],
        semrush_backlinks_indexed_pages: [
          { text: 'List the pages attracting backlinks on', field: 'target', core: true },
        ],
        semrush_backlinks_competitors: [
          { text: 'List domains with a backlink profile similar to', field: 'target', core: true },
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
        { label: 'Domain Overview', id: 'semrush_domain_overview' },
        { label: 'Domain Overview (All Databases)', id: 'semrush_domain_overview_all' },
        { label: 'Domain Overview History', id: 'semrush_domain_overview_history' },
        { label: 'Domain Organic Keywords', id: 'semrush_domain_organic_keywords' },
        { label: 'Domain Paid Keywords', id: 'semrush_domain_paid_keywords' },
        { label: 'Domain Ad Copies', id: 'semrush_domain_ad_copies' },
        { label: 'Domain Ad History', id: 'semrush_domain_ad_history' },
        { label: 'Organic Competitors', id: 'semrush_domain_organic_competitors' },
        { label: 'Paid Competitors', id: 'semrush_domain_paid_competitors' },
        { label: 'Domain PLA Keywords', id: 'semrush_domain_pla_keywords' },
        { label: 'Domain PLA Copies', id: 'semrush_domain_pla_copies' },
        { label: 'Domain vs. Domain', id: 'semrush_domain_vs_domain' },
        { label: 'Subdomain Overview', id: 'semrush_subdomain_overview' },
        { label: 'Subdomain Overview (All Databases)', id: 'semrush_subdomain_overview_all' },
        { label: 'Subdomain Overview History', id: 'semrush_subdomain_overview_history' },
        { label: 'Subdomain Organic Keywords', id: 'semrush_subdomain_organic_keywords' },
        { label: 'Subdomain Paid Keywords', id: 'semrush_subdomain_paid_keywords' },
        { label: 'Subdomain Ad Copies', id: 'semrush_subdomain_ad_copies' },
        { label: 'URL Overview', id: 'semrush_url_overview' },
        { label: 'URL Overview (All Databases)', id: 'semrush_url_overview_all' },
        { label: 'URL Overview History', id: 'semrush_url_overview_history' },
        { label: 'URL Organic Keywords', id: 'semrush_url_organic_keywords' },
        { label: 'URL Paid Keywords', id: 'semrush_url_paid_keywords' },
        { label: 'Keyword Overview', id: 'semrush_keyword_overview' },
        { label: 'Keyword Overview (All Databases)', id: 'semrush_keyword_overview_all' },
        { label: 'Batch Keyword Overview', id: 'semrush_batch_keyword_overview' },
        { label: 'Keyword Difficulty', id: 'semrush_keyword_difficulty' },
        { label: 'Related Keywords', id: 'semrush_related_keywords' },
        { label: 'Broad Match Keywords', id: 'semrush_broad_match_keywords' },
        { label: 'Keyword Questions', id: 'semrush_keyword_questions' },
        { label: 'Organic Results', id: 'semrush_organic_results' },
        { label: 'Paid Results', id: 'semrush_paid_results' },
        { label: 'Keyword Ad History', id: 'semrush_keyword_ad_history' },
        { label: 'Winners and Losers', id: 'semrush_winners_and_losers' },
        { label: 'Top Domains', id: 'semrush_top_domains' },
        { label: 'Backlinks Overview', id: 'semrush_backlinks_overview' },
        { label: 'Backlinks', id: 'semrush_backlinks' },
        { label: 'Referring Domains', id: 'semrush_referring_domains' },
        { label: 'Referring IPs', id: 'semrush_referring_ips' },
        { label: 'Backlink TLD Distribution', id: 'semrush_backlinks_tld_distribution' },
        { label: 'Backlink Country Distribution', id: 'semrush_backlinks_geo_distribution' },
        { label: 'Backlink Anchors', id: 'semrush_backlinks_anchors' },
        { label: 'Indexed Pages', id: 'semrush_backlinks_indexed_pages' },
        { label: 'Backlink Competitors', id: 'semrush_backlinks_competitors' },
      ],
      value: () => 'semrush_domain_overview',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: DOMAIN_OPERATIONS },
      required: { field: 'operation', value: DOMAIN_OPERATIONS },
    },
    {
      id: 'subdomain',
      title: 'Subdomain',
      type: 'short-input',
      placeholder: 'blog.example.com',
      condition: { field: 'operation', value: SUBDOMAIN_OPERATIONS },
      required: { field: 'operation', value: SUBDOMAIN_OPERATIONS },
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://example.com/pricing',
      condition: { field: 'operation', value: URL_OPERATIONS },
      required: { field: 'operation', value: URL_OPERATIONS },
    },
    {
      id: 'phrase',
      title: 'Keyword',
      type: 'short-input',
      placeholder: 'seo tools',
      condition: { field: 'operation', value: PHRASE_OPERATIONS },
      required: { field: 'operation', value: PHRASE_OPERATIONS },
    },
    {
      id: 'phrases',
      title: 'Keywords',
      type: 'short-input',
      placeholder: 'ebay;seo;keyword research',
      condition: { field: 'operation', value: PHRASES_OPERATIONS },
      required: { field: 'operation', value: PHRASES_OPERATIONS },
    },
    {
      id: 'domains',
      title: 'Domains',
      type: 'short-input',
      placeholder: 'nike.com, adidas.com, reebok.com',
      condition: { field: 'operation', value: DOMAINS_OPERATIONS },
      required: { field: 'operation', value: DOMAINS_OPERATIONS },
    },
    {
      id: 'target',
      title: 'Target',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: TARGET_OPERATIONS },
      required: { field: 'operation', value: TARGET_OPERATIONS },
    },
    {
      id: 'competitionType',
      title: 'Compare On',
      type: 'dropdown',
      options: COMPETITION_TYPE_OPTIONS,
      value: () => 'or',
      condition: { field: 'operation', value: 'semrush_domain_vs_domain' },
    },
    {
      id: 'targetType',
      title: 'Target Type',
      type: 'dropdown',
      options: TARGET_TYPE_OPTIONS,
      value: () => 'root_domain',
      condition: { field: 'operation', value: TARGET_OPERATIONS },
    },
    {
      id: 'database',
      title: 'Database',
      type: 'dropdown',
      options: DATABASE_OPTIONS,
      value: () => 'us',
      condition: { field: 'operation', value: DATABASE_OPERATIONS },
      required: { field: 'operation', value: DATABASE_REQUIRED_OPERATIONS },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: PAGED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: PAGED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'displayDate',
      title: 'Historical Month',
      type: 'short-input',
      placeholder: 'YYYYMM15 (defaults to the latest data)',
      condition: { field: 'operation', value: HISTORICAL_DATE_OPERATIONS },
      mode: 'advanced',
      wandConfig: DISPLAY_DATE_WAND_CONFIG,
    },
    {
      id: 'displayDaily',
      title: 'Daily Data Points',
      type: 'switch',
      condition: { field: 'operation', value: DAILY_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'displaySort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'nq_desc',
      condition: { field: 'operation', value: SORTABLE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'displayFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: '+|Nq|Gt|1000',
      condition: { field: 'operation', value: FILTERABLE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Semrush display_filter expression from the description.
The format is <sign>|<column code>|<operator>|<value>, joined by | for several filters.
Signs: + include, - exclude. Operators: Eq, Gt, Lt for numbers; Co contains, Bw begins with, Ew ends with for text.
Examples:
- "search volume above 1000" -> +|Nq|Gt|1000
- "keywords containing seo" -> +|Ph|Co|seo
- "top 10 positions only" -> +|Po|Lt|11

Return ONLY the expression - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the filter (e.g., "search volume above 1000")...',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Semrush API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'semrush_domain_overview',
      'semrush_domain_overview_all',
      'semrush_domain_overview_history',
      'semrush_domain_organic_keywords',
      'semrush_domain_paid_keywords',
      'semrush_domain_ad_copies',
      'semrush_domain_ad_history',
      'semrush_domain_organic_competitors',
      'semrush_domain_paid_competitors',
      'semrush_domain_pla_keywords',
      'semrush_domain_pla_copies',
      'semrush_domain_vs_domain',
      'semrush_subdomain_overview',
      'semrush_subdomain_overview_all',
      'semrush_subdomain_overview_history',
      'semrush_subdomain_organic_keywords',
      'semrush_subdomain_paid_keywords',
      'semrush_subdomain_ad_copies',
      'semrush_url_overview',
      'semrush_url_overview_all',
      'semrush_url_overview_history',
      'semrush_url_organic_keywords',
      'semrush_url_paid_keywords',
      'semrush_keyword_overview',
      'semrush_keyword_overview_all',
      'semrush_batch_keyword_overview',
      'semrush_keyword_difficulty',
      'semrush_related_keywords',
      'semrush_broad_match_keywords',
      'semrush_keyword_questions',
      'semrush_organic_results',
      'semrush_paid_results',
      'semrush_keyword_ad_history',
      'semrush_winners_and_losers',
      'semrush_top_domains',
      'semrush_backlinks_overview',
      'semrush_backlinks',
      'semrush_referring_domains',
      'semrush_referring_ips',
      'semrush_backlinks_tld_distribution',
      'semrush_backlinks_geo_distribution',
      'semrush_backlinks_anchors',
      'semrush_backlinks_indexed_pages',
      'semrush_backlinks_competitors',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation as string | undefined
        return operation && OPERATIONS.includes(operation) ? operation : 'semrush_domain_overview'
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.limit) result.limit = Number(params.limit)
        if (params.offset) result.offset = Number(params.offset)
        if (params.displayDaily !== undefined) {
          result.displayDaily = params.displayDaily === true || params.displayDaily === 'true'
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Semrush API key' },
    domain: { type: 'string', description: 'Domain to analyze' },
    subdomain: { type: 'string', description: 'Subdomain to analyze' },
    url: { type: 'string', description: 'URL to analyze' },
    phrase: { type: 'string', description: 'Keyword to analyze' },
    phrases: { type: 'string', description: 'Semicolon-separated keywords to analyze' },
    domains: { type: 'string', description: 'Comma-separated domains to compare' },
    target: { type: 'string', description: 'Backlink target domain, subdomain, or URL' },
    targetType: {
      type: 'string',
      description: 'Backlink target scope (root_domain, domain, or url)',
    },
    competitionType: {
      type: 'string',
      description: 'Keyword set used for the comparison (or for organic, ad for paid)',
    },
    database: { type: 'string', description: 'Regional Semrush database code' },
    limit: { type: 'number', description: 'Maximum number of rows to return' },
    offset: { type: 'number', description: 'Number of rows to skip, for pagination' },
    displayDate: { type: 'string', description: 'Historical month in YYYYMM15 format' },
    displayDaily: {
      type: 'boolean',
      description: 'Return daily instead of monthly history data points',
    },
    displaySort: { type: 'string', description: 'Semrush display_sort expression' },
    displayFilter: { type: 'string', description: 'Semrush display_filter expression' },
  },

  outputs: {
    overview: {
      type: 'json',
      description:
        'Single-row summary for a domain, subdomain, URL, keyword, or backlink profile, depending on the operation',
    },
    databases: {
      type: 'json',
      description: 'One row of totals per regional database',
    },
    history: {
      type: 'json',
      description: 'Historical rank and traffic data points',
    },
    keywords: {
      type: 'json',
      description: 'Keyword rows, whose fields depend on the selected keyword operation',
    },
    competitors: {
      type: 'json',
      description: 'Competing domains for the organic, paid, or backlink competitor operations',
    },
    domains: {
      type: 'json',
      description:
        'Referring domains, ranked domains, or the compared domains for Domain vs. Domain',
    },
    results: {
      type: 'json',
      description: 'Pages or advertisers appearing on the SERP for a keyword',
    },
    ads: {
      type: 'json',
      description: 'Ad creatives, product listing ads, or historical ad placements',
    },
    backlinks: {
      type: 'json',
      description: 'Backlinks pointing at the target',
    },
    anchors: {
      type: 'json',
      description: 'Anchor text distribution for the backlink profile',
    },
    ips: {
      type: 'json',
      description: 'IP addresses linking to the target',
    },
    zones: {
      type: 'json',
      description: 'Referring domain and backlink counts per top-level domain',
    },
    countries: {
      type: 'json',
      description: 'Referring domain and backlink counts per country',
    },
    pages: {
      type: 'json',
      description: 'Indexed pages of the target and the links they attract',
    },
  },
}

export const SemrushBlockMeta = {
  tags: ['seo', 'marketing', 'data-analytics'],
  url: 'https://www.semrush.com',
  templates: [
    {
      icon: SemrushIcon,
      title: 'Semrush rank tracker',
      prompt:
        'Create a scheduled weekly workflow that pulls Semrush domain organic keywords for my site, writes position changes into a table, and posts a Slack summary of the biggest gainers and losers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush content gap finder',
      prompt:
        'Build a workflow that runs a Semrush Domain vs. Domain comparison between my site and two competitors, has an agent pick the keywords they rank for and I do not, and writes a prioritized content brief table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush keyword research assistant',
      prompt:
        'Create a workflow where I submit a seed keyword, Semrush returns related keywords, broad match variations, and questions, and an agent clusters them into topic groups with search volume and difficulty.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush backlink monitor',
      prompt:
        'Build a scheduled workflow that pulls new Semrush referring domains for my site weekly, flags any with a high Authority Score, and posts a Slack digest with the linking page and anchor text.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush competitor ad watch',
      prompt:
        'Create a scheduled workflow that pulls Semrush domain paid keywords and paid competitors for my top three rivals, diffs them against last week, and emails the growth team a summary of new ad copy and bids.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush landing page audit',
      prompt:
        'Build a workflow that reads a list of landing page URLs from a table, pulls the Semrush URL overview and organic keywords for each, and writes traffic and keyword counts back to the table for review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush new competitor alert',
      prompt:
        'Create a monthly workflow that pulls Semrush organic competitors for my domain, compares them against my tracked competitor list, and posts newly surfaced competitors to Slack for review.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SemrushIcon,
      title: 'Semrush + Ahrefs visibility scoreboard',
      prompt:
        'Build a scheduled monthly workflow that joins Semrush domain overview data with Ahrefs backlink metrics, writes a combined visibility scoreboard table, and emails leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['ahrefs', 'gmail'],
    },
  ],
  skills: [
    {
      name: 'keyword-gap-analysis',
      description:
        'Compare your domain against competitors in Semrush to find the keywords they rank for and you do not.',
      content:
        '# Keyword Gap Analysis\n\nUse the Semrush Domain vs. Domain report to compare keyword profiles side by side.\n\n## Steps\n1. Run Domain vs. Domain with your domain and up to four competitors, choosing organic or paid keywords.\n2. Keep the rows where a competitor ranks well and your position is 0 or far lower.\n3. Run Keyword Overview on the strongest gaps to confirm volume, CPC, and difficulty.\n\n## Output\nA prioritized gap table: keyword, each domain position, search volume, and difficulty, split into quick wins and long-term targets.',
    },
    {
      name: 'competitor-keyword-research',
      description:
        'Identify who competes with a domain in Semrush organic search and pull the keywords driving their traffic.',
      content:
        "# Competitor Keyword Research\n\nFind the real organic competitors for a domain and study what they rank for.\n\n## Steps\n1. Run Organic Competitors for the domain to rank rivals by keyword overlap and traffic.\n2. For the top competitors, run Domain Organic Keywords sorted by traffic share.\n3. Group the results by topic and note which pages of theirs capture the traffic.\n\n## Output\nA ranked competitor list plus each competitor's top traffic-driving keywords and landing pages.",
    },
    {
      name: 'backlink-audit',
      description:
        'Audit a backlink profile in Semrush and report authority, referring domains, and anchor text distribution.',
      content:
        '# Backlink Audit\n\nReview the health and shape of a backlink profile using Semrush Backlink Analytics.\n\n## Steps\n1. Run Backlinks Overview for the target to capture Authority Score and follow/nofollow totals.\n2. Pull Referring Domains sorted by Authority Score, and Backlink Anchors for the anchor mix.\n3. Flag anchor over-optimization and low-authority referring domains worth disavowing.\n\n## Output\nA profile summary with totals, the strongest referring domains, the anchor text distribution, and any risks to address.',
    },
    {
      name: 'keyword-research-report',
      description:
        'Expand a seed keyword in Semrush into a prioritized list with volume, difficulty, and intent.',
      content:
        '# Keyword Research Report\n\nTurn one seed keyword into a working keyword list.\n\n## Steps\n1. Run Related Keywords and Broad Match Keywords on the seed to gather candidates.\n2. Run Keyword Difficulty on the shortlist to score how hard each one is to rank for.\n3. Sort by volume against difficulty and label each keyword with its search intent.\n\n## Output\nA keyword table with volume, CPC, difficulty, and intent, grouped into quick wins and long-term targets.',
    },
    {
      name: 'competitor-ad-copy-research',
      description:
        'Study a competitor paid search strategy in Semrush, including the keywords they bid on and the ad copy they run.',
      content:
        '# Competitor Ad Copy Research\n\nUnderstand what a competitor is buying and how they write their ads.\n\n## Steps\n1. Run Domain Paid Keywords for the competitor to see the terms they bid on and the traffic each drives.\n2. Run Domain Ad Copies to collect the unique creatives and the keyword count behind each.\n3. Run Domain Ad History to see which messages they have sustained month over month.\n\n## Output\nA summary of their bidded keywords, recurring headlines and calls to action, and which creatives they keep running.',
    },
    {
      name: 'question-keyword-content-brief',
      description:
        'Build a content brief from the questions people search around a topic, using Semrush question keywords.',
      content:
        '# Question Keyword Content Brief\n\nTurn real searcher questions into an article outline.\n\n## Steps\n1. Run Keyword Questions on the seed topic to collect question-form searches.\n2. Run Keyword Overview on the seed to anchor the brief to volume and difficulty.\n3. Group the questions into sections and order them the way a reader would ask them.\n\n## Output\nAn outline where each H2 is a real question, annotated with search volume and difficulty.',
    },
    {
      name: 'backlink-gap-analysis',
      description:
        'Find domains linking to your Semrush backlink competitors but not to you, and rank them as outreach targets.',
      content:
        '# Backlink Gap Analysis\n\nSurface link opportunities your competitors already have.\n\n## Steps\n1. Run Backlink Competitors for your target to find domains with a similar backlink profile.\n2. Run Referring Domains for each competitor and for your own domain.\n3. Subtract your referring domains from theirs and rank what is left by Authority Score.\n\n## Output\nA prioritized outreach list: referring domain, Authority Score, which competitors it links to, and why it is a fit.',
    },
    {
      name: 'shopping-ads-competitor-research',
      description:
        'Research a competitor product listing ads in Semrush, including the keywords they trigger on and the products promoted.',
      content:
        '# Shopping Ads Competitor Research\n\nStudy how a retailer competitor runs Google Shopping.\n\n## Steps\n1. Run Domain PLA Keywords for the competitor to see which searches trigger their product ads.\n2. Run Domain PLA Copies to collect the promoted products, titles, and prices.\n3. Compare their prices and product mix against your own catalogue on the same keywords.\n\n## Output\nA report of the shopping keywords they compete on, the products they push, and where your pricing is off.',
    },
  ],
} as const satisfies BlockMeta
