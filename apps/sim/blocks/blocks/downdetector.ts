import { DowndetectorIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { DowndetectorResponse } from '@/tools/downdetector/types'

const COMPANY_ID_OPERATIONS = [
  'downdetector_get_company',
  'downdetector_get_company_status',
  'downdetector_get_company_baseline',
  'downdetector_get_company_last_15',
  'downdetector_get_company_indicators',
  'downdetector_get_company_incidents',
  'downdetector_get_company_attribution',
  'downdetector_get_company_events',
]

const DATE_RANGE_OPERATIONS = [
  'downdetector_get_company_indicators',
  'downdetector_get_reports',
  'downdetector_get_company_incidents',
  'downdetector_get_company_events',
  'downdetector_list_incidents',
]

const INCIDENT_OPERATIONS = ['downdetector_get_company_incidents', 'downdetector_list_incidents']

const FIELDS_OPERATIONS = ['downdetector_get_company', 'downdetector_get_site_companies']

const PAGING_OPERATIONS = [
  'downdetector_search_companies',
  'downdetector_get_company_incidents',
  'downdetector_get_company_events',
  'downdetector_get_site_companies',
  'downdetector_list_incidents',
]

/**
 * Operations whose `page` parameter is an integer page number. Excludes
 * `get_site_companies`, whose pagination uses an opaque token that must not be
 * coerced to a number.
 */
const PAGE_NUMBER_OPERATIONS = [
  'downdetector_search_companies',
  'downdetector_get_company_incidents',
  'downdetector_get_company_events',
  'downdetector_list_incidents',
]

export const DowndetectorBlock: BlockConfig<DowndetectorResponse> = {
  type: 'downdetector',
  name: 'Downdetector',
  description: 'Monitor outages and service status with Downdetector',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Track real-time service outages with the Downdetector Enterprise API. Search monitored companies, read their current status and report trends, inspect problem indicators, and pull incident timelines to power outage alerts and dashboards. Requires a Downdetector Enterprise API plan.',
  docsLink: 'https://docs.sim.ai/integrations/downdetector',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#FFFFFF',
  icon: DowndetectorIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Companies', id: 'downdetector_search_companies' },
        { label: 'Get Company', id: 'downdetector_get_company' },
        { label: 'Get Company Status', id: 'downdetector_get_company_status' },
        { label: 'Get Company Baseline', id: 'downdetector_get_company_baseline' },
        { label: 'Get Company Last 15 Minutes', id: 'downdetector_get_company_last_15' },
        { label: 'Get Company Indicators', id: 'downdetector_get_company_indicators' },
        { label: 'Get Reports', id: 'downdetector_get_reports' },
        { label: 'Get Company Incidents', id: 'downdetector_get_company_incidents' },
        { label: 'Get Company Attribution', id: 'downdetector_get_company_attribution' },
        { label: 'Get Company Events', id: 'downdetector_get_company_events' },
        { label: 'Get Site Companies', id: 'downdetector_get_site_companies' },
        { label: 'Get Provider', id: 'downdetector_get_provider' },
        { label: 'List Incidents', id: 'downdetector_list_incidents' },
        { label: 'List Categories', id: 'downdetector_list_categories' },
        { label: 'List Sites', id: 'downdetector_list_sites' },
      ],
      value: () => 'downdetector_search_companies',
    },
    // Search Companies inputs
    {
      id: 'name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'e.g. slack',
      condition: { field: 'operation', value: 'downdetector_search_companies' },
    },
    {
      id: 'country',
      title: 'Country (ISO-2)',
      type: 'short-input',
      placeholder: 'e.g. US',
      condition: { field: 'operation', value: 'downdetector_search_companies' },
      mode: 'advanced',
    },
    {
      id: 'slug',
      title: 'Slug',
      type: 'short-input',
      placeholder: 'e.g. optimum-cablevision',
      condition: { field: 'operation', value: 'downdetector_search_companies' },
      mode: 'advanced',
    },
    {
      id: 'categoryId',
      title: 'Category ID',
      type: 'short-input',
      placeholder: 'e.g. 42',
      condition: { field: 'operation', value: 'downdetector_search_companies' },
      mode: 'advanced',
    },
    // Company ID (shared by company-scoped operations)
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'e.g. 1234',
      condition: { field: 'operation', value: COMPANY_ID_OPERATIONS },
      required: { field: 'operation', value: COMPANY_ID_OPERATIONS },
    },
    // Slugs (Get Reports)
    {
      id: 'slugs',
      title: 'Slugs',
      type: 'short-input',
      placeholder: 'e.g. slack,zoom',
      condition: { field: 'operation', value: 'downdetector_get_reports' },
      required: { field: 'operation', value: 'downdetector_get_reports' },
    },
    // Site ID (Get Site Companies)
    {
      id: 'siteId',
      title: 'Site ID',
      type: 'short-input',
      placeholder: 'e.g. 12',
      condition: { field: 'operation', value: 'downdetector_get_site_companies' },
      required: { field: 'operation', value: 'downdetector_get_site_companies' },
    },
    // Provider ID (Get Provider)
    {
      id: 'providerId',
      title: 'Provider ID',
      type: 'short-input',
      placeholder: 'e.g. 42',
      condition: { field: 'operation', value: 'downdetector_get_provider' },
      required: { field: 'operation', value: 'downdetector_get_provider' },
    },
    // Fields override (Get Company / Get Site Companies)
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Comma-separated fields (optional)',
      condition: { field: 'operation', value: FIELDS_OPERATIONS },
      mode: 'advanced',
    },
    // Get Company Status threshold
    {
      id: 'threshold',
      title: 'Threshold',
      type: 'short-input',
      placeholder: 'Report count threshold (optional)',
      condition: { field: 'operation', value: 'downdetector_get_company_status' },
      mode: 'advanced',
    },
    // Get Reports interval
    {
      id: 'interval',
      title: 'Interval',
      type: 'short-input',
      placeholder: 'e.g. 15m, 1h, 1d',
      condition: { field: 'operation', value: 'downdetector_get_reports' },
      mode: 'advanced',
    },
    // Only active (incident operations)
    {
      id: 'onlyActive',
      title: 'Only Active',
      type: 'switch',
      condition: { field: 'operation', value: INCIDENT_OPERATIONS },
      mode: 'advanced',
    },
    // Date range (shared)
    {
      id: 'startdate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601, e.g. 2024-01-01T00:00:00+00:00',
      condition: { field: 'operation', value: DATE_RANGE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date-time string (with timezone offset) based on the user description. Return ONLY the timestamp string.',
        placeholder: 'Describe the start time (e.g. "24 hours ago", "start of today")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'enddate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601, e.g. 2024-01-02T00:00:00+00:00',
      condition: { field: 'operation', value: DATE_RANGE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date-time string (with timezone offset) based on the user description. Return ONLY the timestamp string.',
        placeholder: 'Describe the end time (e.g. "now", "end of yesterday")...',
        generationType: 'timestamp',
      },
    },
    // Paging (shared)
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (e.g. 1)',
      condition: { field: 'operation', value: PAGE_NUMBER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10-100',
      condition: { field: 'operation', value: PAGING_OPERATIONS },
      mode: 'advanced',
    },
    // Page token (Get Site Companies uses an opaque token, not an integer page)
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Opaque token from a previous response (X-Page-Next)',
      condition: { field: 'operation', value: 'downdetector_get_site_companies' },
      mode: 'advanced',
    },
    // API key (common to all operations)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Downdetector API token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'downdetector_search_companies',
      'downdetector_get_company',
      'downdetector_get_company_status',
      'downdetector_get_company_baseline',
      'downdetector_get_company_last_15',
      'downdetector_get_company_indicators',
      'downdetector_get_reports',
      'downdetector_get_company_incidents',
      'downdetector_get_company_attribution',
      'downdetector_get_company_events',
      'downdetector_get_site_companies',
      'downdetector_get_provider',
      'downdetector_list_incidents',
      'downdetector_list_categories',
      'downdetector_list_sites',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.categoryId) result.categoryId = Number(params.categoryId)
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        if (params.threshold) result.threshold = Number(params.threshold)
        if (params.onlyActive !== undefined && params.onlyActive !== '')
          result.onlyActive = params.onlyActive === true || params.onlyActive === 'true'
        // `get_site_companies` paginates with an opaque token; every other paged
        // operation uses an integer page number. Always overwrite `page` (with the
        // token, a number, or undefined) so a stale value from a now-hidden field
        // can never leak into the wrong endpoint via the merged inputs.
        if (params.operation === 'downdetector_get_site_companies') {
          result.page = params.pageToken || undefined
        } else {
          result.page = params.page ? Number(params.page) : undefined
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Downdetector API Bearer token' },
    name: { type: 'string', description: 'Company name to search for' },
    country: { type: 'string', description: 'ISO-2 country code filter' },
    slug: { type: 'string', description: 'Exact company slug filter' },
    categoryId: { type: 'number', description: 'Category id filter' },
    companyId: { type: 'string', description: 'Downdetector company id' },
    slugs: { type: 'string', description: 'Comma-separated company slugs' },
    siteId: { type: 'string', description: 'Downdetector site id' },
    providerId: { type: 'string', description: 'Downdetector provider id' },
    fields: { type: 'string', description: 'Comma-separated company fields to return' },
    threshold: { type: 'number', description: 'Report count threshold for status' },
    interval: { type: 'string', description: 'Report bucket interval (e.g. 15m, 1h)' },
    onlyActive: { type: 'boolean', description: 'Only return active incidents' },
    startdate: { type: 'string', description: 'ISO 8601 start of the time range' },
    enddate: { type: 'string', description: 'ISO 8601 end of the time range' },
    page: { type: 'number', description: 'Page number for paginated results' },
    pageToken: { type: 'string', description: 'Opaque page token for site companies pagination' },
    pageSize: { type: 'number', description: 'Number of results per page' },
  },
  outputs: {
    companies: { type: 'json', description: 'List of companies (search or site companies)' },
    company: { type: 'json', description: 'Company details' },
    status: { type: 'string', description: 'Current status (success, warning, or danger)' },
    baseline: { type: 'number', description: 'Current baseline report value' },
    count: { type: 'number', description: 'Number of reports over the last 15 minutes' },
    indicators: { type: 'json', description: 'Reported problem indicators' },
    reports: { type: 'json', description: 'Report counts bucketed by interval' },
    incidents: { type: 'json', description: 'List of incidents' },
    attribution: { type: 'json', description: 'Incident attribution detail' },
    events: { type: 'json', description: 'List of company events' },
    provider: { type: 'json', description: 'Provider details' },
    categories: { type: 'json', description: 'List of categories' },
    sites: { type: 'json', description: 'List of sites' },
    nextPage: {
      type: 'string',
      description: 'Cursor for the next page of paginated results (null on the last page)',
    },
  },
}

export const DowndetectorBlockMeta = {
  tags: ['monitoring', 'incident-management'],
  url: 'https://downdetector.com/enterprise',
  templates: [
    {
      icon: DowndetectorIcon,
      title: 'Downdetector outage alerter',
      prompt:
        'Build a scheduled workflow that checks the Downdetector status of my critical vendors every 15 minutes and posts a Slack alert whenever any of them flips to a "danger" (outage) status.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DowndetectorIcon,
      title: 'Downdetector incident logger',
      prompt:
        'Create a scheduled workflow that pulls active Downdetector incidents for my key services hourly and appends new incidents to a tables-based incident log with start time, peak user impact, and total reports.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['incident-management', 'reporting'],
    },
    {
      icon: DowndetectorIcon,
      title: 'Downdetector report-spike watcher',
      prompt:
        'Build a scheduled workflow that fetches the last hour of Downdetector reports for a company slug, compares the latest bucket against the company baseline, and emails me when reports spike well above baseline.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: DowndetectorIcon,
      title: 'Downdetector root-cause summarizer',
      prompt:
        'Create a workflow that, given a company id, pulls the current Downdetector status and top problem indicators and has an agent summarize what users are most likely experiencing right now.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['incident-management', 'monitoring'],
    },
    {
      icon: DowndetectorIcon,
      title: 'Downdetector vendor status digest',
      prompt:
        'Build a scheduled daily workflow that searches Downdetector for each of my vendors, reads their current status and 24h report stats, writes a status digest table, and posts a Slack summary.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DowndetectorIcon,
      title: 'Downdetector support deflection',
      prompt:
        'Create a workflow triggered when a support ticket arrives that checks the Downdetector status of the affected service and, if there is a confirmed outage, replies to the customer that the issue is a known provider outage.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['incident-management', 'customer-support'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: DowndetectorIcon,
      title: 'Downdetector competitor outage tracker',
      prompt:
        'Build a scheduled workflow that lists all active Downdetector incidents across a category, filters to my competitors, and logs their outages to a table so the team can track reliability over time.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'check-service-outage',
      description:
        'Look up a service on Downdetector and report whether it is currently experiencing an outage.',
      content:
        '# Check Service Outage\n\nDetermine whether a given service is currently down according to Downdetector.\n\n## Steps\n1. Search companies by name to resolve the service to a company id.\n2. Get the company status (success / warning / danger).\n3. If the status is warning or danger, pull the company indicators to see what users are reporting.\n\n## Output\nA short verdict: is the service up, degraded, or down, and the top reported problems if any.',
    },
    {
      name: 'monitor-vendor-outages',
      description:
        'Continuously watch a set of critical vendors on Downdetector and alert when any goes into an outage state.',
      content:
        '# Monitor Vendor Outages\n\nKeep an eye on your critical vendors and surface outages as they happen.\n\n## Steps\n1. For each vendor, resolve its company id via company search.\n2. Get the current status for each company on a schedule.\n3. Flag any company whose status is "danger" and summarize the impact.\n\n## Output\nA list of vendors currently in an outage state, ready to drive an alert.',
    },
    {
      name: 'log-service-incidents',
      description:
        'Pull Downdetector incidents for a service and record them in a structured incident log.',
      content:
        '# Log Service Incidents\n\nMaintain a running log of Downdetector incidents for the services you depend on.\n\n## Steps\n1. Resolve the service to a company id.\n2. Fetch the company incidents for the desired time window.\n3. Record each incident (start, resolved, peak user impact, total reports) into a table, skipping ones already logged.\n\n## Output\nAn incident log table with one row per outage and its key metrics.',
    },
    {
      name: 'detect-report-spikes',
      description:
        "Compare recent Downdetector report volume against a company's baseline to detect abnormal spikes.",
      content:
        '# Detect Report Spikes\n\nDetect when outage reports for a service spike above normal levels.\n\n## Steps\n1. Resolve the service to a company slug and id.\n2. Get the recent reports bucketed by interval.\n3. Get the current baseline and compare the latest bucket against it.\n\n## Output\nWhether reports are abnormally elevated, with the current count and the baseline for context.',
    },
  ],
} as const satisfies BlockMeta
