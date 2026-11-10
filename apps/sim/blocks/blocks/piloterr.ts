import { PiloterrIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

export const PiloterrBlock: BlockConfig = {
  type: 'piloterr',
  name: 'Piloterr',
  description: 'Scrape web pages, search engines, marketplaces and company data',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Fetch or render any web page, take screenshots, detect a website's technologies, search Google, Amazon and eBay, and get structured LinkedIn and Crunchbase company profiles and Zillow properties, with proxies and anti-bot handling included.",
  docsLink: 'https://docs.sim.ai/integrations/piloterr',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: PiloterrIcon,
  canvasPresentation: {
    defaultTitle: 'Piloterr',
    sentences: {
      byOperation: {
        fetch_html: [{ text: 'Fetch the HTML of', field: 'url', core: true }],
        render_html: [{ text: 'Render', field: 'url', core: true }, 'in a browser'],
        screenshot: [
          { text: 'Take a screenshot of', field: 'url', core: true },
          { text: 'as', field: 'format' },
        ],
        detect_technologies: [{ text: 'Detect the technologies of', field: 'url', core: true }],
        google_search: [
          { text: 'Search Google for', field: 'query', core: true },
          { text: ', from', field: 'country' },
        ],
        amazon_search: [{ text: 'Search Amazon for', field: 'query', core: true }],
        ebay_get_listing: [{ text: 'Get the eBay listing', field: 'item', core: true }],
        ebay_search: [{ text: 'Search eBay for', field: 'query', core: true }],
        linkedin_company: [
          'Get a LinkedIn company profile',
          { text: 'for', field: 'query' },
          { text: 'for the website', field: 'domain' },
        ],
        crunchbase_company: [
          'Get a Crunchbase company profile',
          { text: 'for', field: 'query' },
          { text: 'for the website', field: 'domain' },
        ],
        zillow_property: [{ text: 'Get the Zillow property', field: 'url', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Fetch HTML', id: 'fetch_html' },
        { label: 'Render HTML', id: 'render_html' },
        { label: 'Take Screenshot', id: 'screenshot' },
        { label: 'Detect Technologies', id: 'detect_technologies' },
        { label: 'Google Search', id: 'google_search' },
        { label: 'Amazon Search', id: 'amazon_search' },
        { label: 'Get eBay Listing', id: 'ebay_get_listing' },
        { label: 'eBay Search', id: 'ebay_search' },
        { label: 'Get LinkedIn Company', id: 'linkedin_company' },
        { label: 'Get Crunchbase Company', id: 'crunchbase_company' },
        { label: 'Get Zillow Property', id: 'zillow_property' },
      ],
      value: () => 'fetch_html',
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: {
        field: 'operation',
        value: [
          'fetch_html',
          'render_html',
          'screenshot',
          'detect_technologies',
          'zillow_property',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'fetch_html',
          'render_html',
          'screenshot',
          'detect_technologies',
          'zillow_property',
        ],
      },
    },
    {
      id: 'waitInSeconds',
      title: 'Wait',
      type: 'short-input',
      placeholder: 'Defaults to 0',
      condition: { field: 'operation', value: 'render_html' },
      mode: 'advanced',
    },
    {
      id: 'blockAds',
      title: 'Block Ads',
      type: 'switch',
      condition: { field: 'operation', value: 'render_html' },
      mode: 'advanced',
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'PNG', id: 'png' },
        { label: 'JPEG', id: 'jpeg' },
        { label: 'WebP', id: 'webp' },
        { label: 'PDF', id: 'pdf' },
      ],
      value: () => 'png',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'fullPage',
      title: 'Full Page',
      type: 'switch',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'device',
      title: 'Device',
      type: 'dropdown',
      options: [
        { label: 'iPhone 14 Pro', id: 'iphone_14_pro' },
        { label: 'iPhone 14 Pro Max', id: 'iphone_14_pro_max' },
        { label: 'iPhone 13 Pro Max', id: 'iphone_13_pro_max' },
        { label: 'iPhone 13 mini', id: 'iphone_13_mini' },
        { label: 'iPhone 12', id: 'iphone_12' },
        { label: 'iPhone X', id: 'iphone_x' },
        { label: 'iPad', id: 'ipad' },
        { label: 'Pixel 7 Pro', id: 'pixel_7_pro' },
        { label: 'Pixel 6a', id: 'pixel_6a' },
        { label: 'Pixel 5', id: 'pixel_5' },
        { label: 'Galaxy S23 Ultra', id: 'galaxy_s23_ultra' },
        { label: 'Galaxy S23', id: 'galaxy_s23' },
        { label: 'Galaxy S8', id: 'galaxy_s8' },
        { label: 'Galaxy Fold4', id: 'galaxy_fold4' },
        { label: 'Huawei Mate 50 Pro', id: 'huawei_mate_50_pro' },
        { label: 'Huawei P60 Pro', id: 'huawei_p60_pro' },
        { label: 'Redmi Note 12 Pro', id: 'redmi_note_12_pro' },
        { label: 'Redmi Note 11', id: 'redmi_note_11' },
      ],
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'selector',
      title: 'Element Selector',
      type: 'short-input',
      placeholder: '#pricing',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'viewportWidth',
      title: 'Viewport Width',
      type: 'short-input',
      placeholder: 'Defaults to 1280',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'viewportHeight',
      title: 'Viewport Height',
      type: 'short-input',
      placeholder: 'Defaults to 1024',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'delay',
      title: 'Delay',
      type: 'short-input',
      placeholder: 'Defaults to 0',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'removeCookieBanners',
      title: 'Remove Cookie Banners',
      type: 'switch',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'removeAds',
      title: 'Remove Ads',
      type: 'switch',
      condition: { field: 'operation', value: 'screenshot' },
      mode: 'advanced',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter a search query',
      condition: {
        field: 'operation',
        value: [
          'google_search',
          'amazon_search',
          'ebay_search',
          'linkedin_company',
          'crunchbase_company',
        ],
      },
      required: { field: 'operation', value: ['google_search', 'amazon_search', 'ebay_search'] },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'us',
      condition: { field: 'operation', value: 'google_search' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      condition: { field: 'operation', value: 'google_search' },
      mode: 'advanced',
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Paris, France',
      condition: { field: 'operation', value: 'google_search' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Defaults to 1',
      condition: { field: 'operation', value: ['google_search', 'amazon_search', 'ebay_search'] },
      mode: 'advanced',
    },
    {
      id: 'numResults',
      title: 'Results per Page',
      type: 'short-input',
      placeholder: 'Defaults to 10',
      condition: { field: 'operation', value: 'google_search' },
      mode: 'advanced',
    },
    {
      id: 'marketplace',
      title: 'Marketplace',
      type: 'short-input',
      placeholder: 'com',
      condition: { field: 'operation', value: 'amazon_search' },
      mode: 'advanced',
    },
    {
      id: 'item',
      title: 'Item ID or URL',
      type: 'short-input',
      placeholder: '257758922911',
      condition: { field: 'operation', value: 'ebay_get_listing' },
      required: { field: 'operation', value: 'ebay_get_listing' },
    },
    {
      id: 'domain',
      title: 'Website Domain',
      type: 'short-input',
      placeholder: 'ferrari.com',
      condition: { field: 'operation', value: ['linkedin_company', 'crunchbase_company'] },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Piloterr API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'piloterr_fetch_html',
      'piloterr_render_html',
      'piloterr_screenshot',
      'piloterr_detect_technologies',
      'piloterr_google_search',
      'piloterr_amazon_search',
      'piloterr_ebay_get_listing',
      'piloterr_ebay_search',
      'piloterr_linkedin_company',
      'piloterr_crunchbase_company',
      'piloterr_zillow_property',
    ],
    config: {
      tool: (params) => `piloterr_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.operation === 'render_html') {
          result.waitInSeconds = parseOptionalNumberInput(params.waitInSeconds, 'Wait', { min: 0 })
        }
        if (params.operation === 'screenshot') {
          result.viewportWidth = parseOptionalNumberInput(params.viewportWidth, 'Viewport Width', {
            integer: true,
            min: 1,
          })
        }
        if (params.operation === 'screenshot') {
          result.viewportHeight = parseOptionalNumberInput(
            params.viewportHeight,
            'Viewport Height',
            { integer: true, min: 1 }
          )
        }
        if (params.operation === 'screenshot') {
          result.delay = parseOptionalNumberInput(params.delay, 'Delay', { min: 0 })
        }
        if (['google_search', 'amazon_search', 'ebay_search'].includes(params.operation)) {
          result.page = parseOptionalNumberInput(params.page, 'Page', { integer: true, min: 1 })
        }
        if (params.operation === 'google_search') {
          result.numResults = parseOptionalNumberInput(params.numResults, 'Results per Page', {
            integer: true,
            min: 1,
          })
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'URL of the page (e.g., "https://example.com")' },
    waitInSeconds: {
      type: 'number',
      description: 'Seconds to wait after the page loads before reading the HTML (defaults to 0)',
    },
    blockAds: { type: 'boolean', description: 'Block ad requests while rendering' },
    format: {
      type: 'string',
      description: 'Output format: png, jpeg, webp or pdf (defaults to "png")',
    },
    fullPage: {
      type: 'boolean',
      description: 'Capture the entire page instead of the visible viewport',
    },
    device: { type: 'string', description: 'Device to emulate (e.g., "iphone_14_pro")' },
    selector: {
      type: 'string',
      description: 'CSS selector of one element to capture (e.g., "#pricing")',
    },
    viewportWidth: {
      type: 'number',
      description: 'Width of the browser viewport in pixels (defaults to 1280)',
    },
    viewportHeight: {
      type: 'number',
      description: 'Height of the browser viewport in pixels (defaults to 1024)',
    },
    delay: { type: 'number', description: 'Seconds to wait before capturing (defaults to 0)' },
    removeCookieBanners: { type: 'boolean', description: 'Remove cookie banners before capturing' },
    removeAds: { type: 'boolean', description: 'Remove ads before capturing' },
    query: { type: 'string', description: 'Search query (e.g., "best electric cars")' },
    country: { type: 'string', description: 'Two-letter country code to search from (e.g., "us")' },
    language: {
      type: 'string',
      description: 'Two-letter language code of the results (e.g., "en")',
    },
    location: {
      type: 'string',
      description: 'City or region to search from (e.g., "Paris, France")',
    },
    page: { type: 'number', description: 'Page of results, starting at 1' },
    numResults: { type: 'number', description: 'Number of results per page (e.g., 10)' },
    marketplace: {
      type: 'string',
      description:
        'Amazon domain extension of the marketplace (e.g., "com", "fr", "co.uk"; defaults to "com")',
    },
    item: { type: 'string', description: 'eBay item ID or listing URL (e.g., "257758922911")' },
    domain: {
      type: 'string',
      description:
        'Company website domain, when the LinkedIn page is unknown (e.g., "ferrari.com")',
    },
    apiKey: { type: 'string', description: 'Piloterr API key' },
  },
  outputs: {
    html: { type: 'string', description: 'HTML of the page' },
    file: {
      type: 'file',
      description: 'Screenshot or PDF of the page, stored in the execution files',
    },
    technologies: { type: 'json', description: 'Technologies detected on the website' },
    results: { type: 'json', description: 'Organic results' },
    totalResults: { type: 'number', description: 'Estimated total number of results' },
    hasNextPage: { type: 'boolean', description: 'Whether another page of results exists' },
    products: { type: 'json', description: 'Products found on Amazon' },
    itemId: { type: 'string', description: 'eBay item ID' },
    title: { type: 'string', description: 'Title of the listing' },
    url: { type: 'string', description: 'URL of the eBay listing' },
    price: { type: 'number', description: 'Price of the eBay listing or the Zillow home' },
    currency: { type: 'string', description: 'ISO 4217 code of the prices' },
    priceDisplay: { type: 'string', description: 'Price as eBay displays it' },
    condition: { type: 'string', description: 'Condition of the item, such as New or Used' },
    conditionDescription: { type: 'string', description: "Seller's description of the condition" },
    availability: { type: 'string', description: 'Availability, such as InStock or OutOfStock' },
    isBuyItNow: { type: 'boolean', description: 'Whether the listing can be bought now' },
    isBestOffer: { type: 'boolean', description: 'Whether the seller accepts best offers' },
    watchers: { type: 'number', description: 'Number of people watching the listing' },
    imageUrl: { type: 'string', description: 'URL of the main image' },
    seller: { type: 'json', description: 'Seller of the listing' },
    shipping: { type: 'string', description: 'Shipping summary' },
    returns: { type: 'string', description: 'Returns policy summary' },
    specifications: { type: 'json', description: 'Item specifics' },
    paymentMethods: { type: 'json', description: 'Accepted payment methods' },
    listings: { type: 'json', description: 'Listings found on eBay' },
    nextPageUrl: { type: 'string', description: 'URL of the next page of results' },
    page: { type: 'number', description: 'Current page' },
    companyName: { type: 'string', description: 'Name of the company' },
    companyId: { type: 'number', description: 'LinkedIn ID of the company' },
    companyUrl: { type: 'string', description: 'URL of the LinkedIn page' },
    tagline: { type: 'string', description: 'Tagline of the company' },
    description: { type: 'string', description: 'Description of the company, listing or home' },
    website: { type: 'string', description: 'Website of the company' },
    industry: { type: 'string', description: 'Industry of the company' },
    founded: { type: 'number', description: 'Year the company was founded' },
    staffCount: { type: 'number', description: 'Number of employees on LinkedIn' },
    staffRange: { type: 'string', description: 'Company size range' },
    followerCount: { type: 'number', description: 'Number of LinkedIn followers' },
    logoUrl: { type: 'string', description: 'URL of the company logo' },
    specialities: { type: 'json', description: 'Specialties of the company' },
    locations: { type: 'json', description: 'Office addresses' },
    headquarter: { type: 'json', description: 'Headquarters address' },
    similarCompanies: { type: 'json', description: 'Similar companies LinkedIn suggests' },
    name: { type: 'string', description: 'Name of the company' },
    permalink: { type: 'string', description: 'Crunchbase permalink of the company' },
    headline: { type: 'string', description: 'Short description' },
    logo: { type: 'string', description: 'URL of the company logo' },
    companyType: { type: 'string', description: 'Company type, such as for profit' },
    employeeCount: { type: 'string', description: 'Employee count range' },
    foundedOn: { type: 'string', description: 'Founding date' },
    phoneNumber: { type: 'string', description: 'Phone number of the company' },
    contactEmail: { type: 'string', description: 'Contact email of the company' },
    heatScore: { type: 'number', description: 'Crunchbase heat score' },
    growthScore: { type: 'number', description: 'Crunchbase growth score' },
    aliases: { type: 'json', description: 'Other names of the company' },
    tags: { type: 'json', description: 'Crunchbase tags, such as unicorn' },
    categories: { type: 'json', description: 'Industry categories' },
    headquartersLocation: {
      type: 'json',
      description: 'Headquarters location, from city to continent',
    },
    investors: { type: 'json', description: 'Investors of the company' },
    zpid: { type: 'number', description: 'Zillow property ID' },
    streetAddress: { type: 'string', description: 'Street address' },
    city: { type: 'string', description: 'City' },
    state: { type: 'string', description: 'State' },
    zipcode: { type: 'string', description: 'ZIP code' },
    county: { type: 'string', description: 'County' },
    zestimate: { type: 'number', description: "Zillow's estimated market value" },
    homeStatus: { type: 'string', description: 'Status, such as FOR_SALE or RECENTLY_SOLD' },
    homeType: { type: 'string', description: 'Home type, such as SINGLE_FAMILY' },
    bedrooms: { type: 'number', description: 'Number of bedrooms' },
    bathrooms: { type: 'number', description: 'Number of bathrooms' },
    livingArea: { type: 'number', description: 'Living area in square feet' },
    lotSize: { type: 'number', description: 'Lot size in square feet' },
    yearBuilt: { type: 'number', description: 'Year the home was built' },
    pricePerSquareFoot: { type: 'number', description: 'Price per square foot' },
    latitude: { type: 'number', description: 'Latitude' },
    longitude: { type: 'number', description: 'Longitude' },
    photos: { type: 'json', description: 'Photos of the home' },
  },
}

export const PiloterrBlockMeta = {
  tags: ['web-scraping', 'enrichment', 'seo'],
  url: 'https://www.piloterr.com',
  templates: [
    {
      icon: PiloterrIcon,
      title: 'Piloterr competitor price monitor',
      prompt:
        "Build a scheduled workflow that searches Amazon and eBay with Piloterr for our products' competitors every day, logs prices to a table, and posts significant price changes to Slack.",
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'sales',
      tags: ['monitoring', 'ecommerce'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PiloterrIcon,
      title: 'Piloterr account enrichment',
      prompt:
        'Create a workflow that enriches each new CRM account with Piloterr: its LinkedIn company profile (industry, size, headquarters) and its Crunchbase profile (description, investors), written back to the record.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['enrichment', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: PiloterrIcon,
      title: 'Piloterr tech stack prospecting',
      prompt:
        'Build a workflow that detects the technologies of each prospect website with Piloterr and keeps the companies that run a given CMS or analytics tool in a lead table.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['lead-generation', 'enrichment'],
    },
    {
      icon: PiloterrIcon,
      title: 'Piloterr SERP tracker',
      prompt:
        'Create a scheduled workflow that searches Google with Piloterr for our target keywords every week and records the position of our domain and the top three competitors in a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'monitoring'],
    },
    {
      icon: PiloterrIcon,
      title: 'Piloterr real estate watcher',
      prompt:
        'Build a workflow that reads a list of Zillow homes with Piloterr, compares each price with its Zestimate, and has an agent shortlist the homes priced below their estimate.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'real-estate'],
    },
    {
      icon: PiloterrIcon,
      title: 'Piloterr page change detector',
      prompt:
        "Create a scheduled workflow that renders competitors' pricing pages with Piloterr, has an agent compare the text with last week's version, and emails a summary of the changes.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['monitoring', 'research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PiloterrIcon,
      title: 'Piloterr investor research',
      prompt:
        'Build an agent that takes a company name, reads its Crunchbase profile with Piloterr, and writes a brief with its description, size, categories, investors and products.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['research', 'enrichment'],
    },
  ],
  skills: [
    {
      name: 'enrich-company-profile',
      description:
        'Build a company profile from its LinkedIn and Crunchbase pages with Piloterr, starting from a name or website domain.',
      content:
        '# Enrich Company Profile\n\nGather the key facts about a company for sales or research.\n\n## Steps\n1. Run the get LinkedIn company operation with the company page, or with its website domain when the page is unknown.\n2. Run the get Crunchbase company operation with the company name or website domain.\n3. Combine industry, size, headquarters and specialties from LinkedIn with the description, categories, investors and products from Crunchbase.\n\n## Output\nReturn one company profile, noting which source each fact comes from.',
    },
    {
      name: 'monitor-marketplace-prices',
      description:
        'Track product prices on Amazon and eBay with Piloterr searches and report the changes.',
      content:
        '# Monitor Marketplace Prices\n\nFollow the price of products across Amazon and eBay.\n\n## Steps\n1. Run the Amazon search operation and the eBay search operation with the product name.\n2. Keep the results that match the product, with price, currency, condition and seller.\n3. Compare with the previous prices and note drops and rises.\n\n## Output\nReturn the current lowest price on each marketplace and the changes since the last check.',
    },
    {
      name: 'detect-website-stack',
      description:
        'Identify the technologies a website runs with Piloterr, for prospecting or competitive research.',
      content:
        '# Detect Website Stack\n\nFind out which CMS, frameworks, analytics and hosting a site uses.\n\n## Steps\n1. Run the detect technologies operation on the website URL.\n2. Group the technologies by category and keep those with high confidence.\n3. Note versions when they are detected.\n\n## Output\nReturn the technologies grouped by category, with version and confidence.',
    },
    {
      name: 'track-google-rankings',
      description:
        "Find where a domain ranks on Google for a list of keywords with Piloterr's Google search.",
      content:
        "# Track Google Rankings\n\nMeasure the Google position of a site for its keywords.\n\n## Steps\n1. Run the Google search operation for each keyword, with the country and language of the target market.\n2. Find the first result whose domain matches the site and note its position.\n3. List the domains ranking above it.\n\n## Output\nReturn each keyword with the site's position (or not ranked) and the competitors ahead of it.",
    },
  ],
} as const satisfies BlockMeta
