import { GoogleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { GoogleAdsResponse } from '@/tools/google_ads/types'

// Google Ads accounts configuration
const GOOGLE_ADS_ACCOUNTS = {
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

export const GoogleAdsBlock: BlockConfig<GoogleAdsResponse> = {
  type: 'google_ads',
  name: 'Google Ads',
  description: 'Query Google Ads campaign data and analytics',
  longDescription:
    'The Google Ads block allows you to query comprehensive campaign performance data including clicks, impressions, costs, conversions, and other key metrics. Supports flexible date ranges, account filtering, and various query types including campaigns, performance, and cost analysis.',
  docsLink: 'https://docs.sim.ai/tools/google-ads',
  category: 'tools',
  bgColor: '#4285f4',
  icon: GoogleIcon,
  subBlocks: [
    {
      id: 'accounts',
      title: 'Google Ads Account',
      type: 'dropdown',
      options: Object.entries(GOOGLE_ADS_ACCOUNTS).map(([key, account]) => ({
        label: account.name,
        id: key,
        value: account.id,
      })),
      placeholder: 'Select account...',
      required: true,
    },
    {
      id: 'question',
      title: 'Question / Query',
      type: 'long-input',
      placeholder:
        'Ask any question about Google Ads data, e.g., "Show me campaign performance for last 30 days", "What are my top spending campaigns this month?", "How many conversions did I get last week?"',
      rows: 3,
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `You are a Google Ads query assistant. Help users create effective questions for Google Ads data analysis.

### EXAMPLES OF GOOD QUESTIONS
- "Show me campaign performance for last 30 days"
- "What are my top spending campaigns this month?"
- "How many conversions did I get last week?"
- "Which campaigns have the highest CTR?"
- "Show me cost analysis for the last 15 days"
- "What's my impression share for active campaigns?"
- "Compare this month vs last month performance"
- "Show me keyword performance data"

### AVAILABLE METRICS
- Clicks, Impressions, Cost, Conversions
- CTR (Click-through rate), CPC (Cost per click)
- Conversion rate, Cost per conversion
- Impression share, Budget lost share
- ROAS (Return on ad spend)

### TIME PERIODS
- Last 7/15/30 days
- This/Last month, This/Last week
- Yesterday, Today
- Specific date ranges

Generate a clear, specific question about Google Ads performance based on the user's request.`,
      },
    },
  ],
  tools: {
    access: ['google_ads_query'],
    config: {
      tool: () => 'google_ads_query',
      params: (params) => ({
        accounts: params.accounts,
        question: params.question, // Pass the user's question
        query_type: 'campaigns', // Default fallback
        period_type: 'last_30_days', // Default fallback
        output_format: 'detailed',
        sort_by: 'cost_desc',
      }),
    },
  },
  inputs: {
    question: { type: 'string', description: 'User question about Google Ads data' },
    accounts: { type: 'string', description: 'Selected Google Ads account' },
  },
  outputs: {
    query: { type: 'string', description: 'Executed query' },
    results: { type: 'json', description: 'Google Ads campaign data and analytics' },
    grand_totals: { type: 'json', description: 'Aggregated totals across all accounts' },
    data_availability: { type: 'json', description: 'Data availability information' },
  },
}
