import { PowerBIIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

const WORKSPACE_FIELD = ['workspaceSelector', 'manualWorkspaceId'] as const
const DATASET_FIELD = ['datasetSelector', 'manualDatasetId'] as const
const REPORT_FIELD = ['reportSelector', 'manualReportId'] as const

/** Parses resolved switch values without treating the string "false" as truthy. */
function parseIncludeNulls(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '') return true
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  throw new Error('Include nulls must be true or false.')
}

export const PowerBIBlock: BlockConfig = {
  type: 'powerbi',
  name: 'Power BI',
  description: 'Query semantic models and manage reports and refreshes',
  longDescription: `Connect a home-tenant organizational account through the Power BI Microsoft connection to list named workspaces, inspect reports and semantic models, execute DAX queries, request standard refreshes, and read refresh history. Microsoft Graph connections cannot substitute for this delegated OAuth connection. Self-hosted installations use the shared Microsoft app registration and register /api/auth/oauth2/callback/microsoft-powerbi as a Web redirect URI. Workspace listing supports a result limit, offset, and OData filter; reports and semantic models return flat lists. Read-only models may contain only their ID and name, and paginated reports may omit their semantic-model ID. Missing optional fields are null and do not establish permission or feature availability. Keep results small with summaries or TOPN: provider JSON reads are limited to 20 MiB, and workflow tool responses have a stricter 10 MiB inline budget. My Workspace, cross-tenant guest configuration, Credential Groups, service principals, impersonation, enhanced refresh, report exports, dashboards, and triggers are outside this version.`,
  docsLink: 'https://docs.sim.ai/integrations/powerbi',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  authMode: AuthMode.OAuth,
  bgColor: '#FFFFFF',
  icon: PowerBIIcon,
  canvasPresentation: {
    defaultTitle: 'Power BI',
    sentences: {
      byOperation: {
        powerbi_list_workspaces: [
          'List accessible workspaces',
          { text: ', matching', field: 'workspaceFilter' },
        ],
        powerbi_list_reports: [{ text: 'List reports in', field: WORKSPACE_FIELD, core: true }],
        powerbi_get_report: [
          { text: 'Read', field: REPORT_FIELD, core: true },
          { text: 'in', field: WORKSPACE_FIELD, core: true },
        ],
        powerbi_list_datasets: [
          { text: 'List semantic models in', field: WORKSPACE_FIELD, core: true },
        ],
        powerbi_get_dataset: [
          { text: 'Read', field: DATASET_FIELD, core: true },
          { text: 'in', field: WORKSPACE_FIELD, core: true },
        ],
        powerbi_execute_query: [
          { text: 'Query', field: DATASET_FIELD, core: true },
          { text: 'in', field: WORKSPACE_FIELD, core: true },
        ],
        powerbi_refresh_dataset: [
          { text: 'Request a refresh of', field: DATASET_FIELD, core: true },
          { text: 'in', field: WORKSPACE_FIELD, core: true },
        ],
        powerbi_get_refresh_history: [
          { text: 'Read refresh history of', field: DATASET_FIELD, core: true },
          { text: 'in', field: WORKSPACE_FIELD, core: true },
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
        { label: 'List Workspaces', id: 'powerbi_list_workspaces' },
        { label: 'List Reports', id: 'powerbi_list_reports' },
        { label: 'Get Report', id: 'powerbi_get_report' },
        { label: 'List Semantic Models', id: 'powerbi_list_datasets' },
        { label: 'Get Semantic Model', id: 'powerbi_get_dataset' },
        { label: 'Execute DAX Query', id: 'powerbi_execute_query' },
        { label: 'Refresh Semantic Model', id: 'powerbi_refresh_dataset' },
        { label: 'Get Refresh History', id: 'powerbi_get_refresh_history' },
      ],
      value: () => 'powerbi_execute_query',
    },
    {
      id: 'credential',
      title: 'Power BI Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'microsoft-powerbi',
      requiredScopes: getScopesForService('microsoft-powerbi').filter((scope) =>
        scope.startsWith('https://analysis.windows.net/powerbi/api/')
      ),
      placeholder: 'Select Power BI account',
      mode: 'basic',
      required: true,
      paramVisibility: 'user-only',
    },
    {
      id: 'manualCredential',
      title: 'Power BI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      placeholder: 'Enter Power BI credential ID',
      mode: 'advanced',
      required: true,
      paramVisibility: 'user-only',
    },
    {
      id: 'workspaceSelector',
      title: 'Workspace',
      type: 'project-selector',
      canonicalParamId: 'groupId',
      selectorKey: 'powerbi.workspaces',
      serviceId: 'microsoft-powerbi',
      placeholder: 'Select workspace',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'powerbi_list_workspaces', not: true },
      required: true,
    },
    {
      id: 'manualWorkspaceId',
      title: 'Workspace',
      type: 'short-input',
      canonicalParamId: 'groupId',
      placeholder: 'Enter workspace ID',
      dependsOn: ['oauthCredential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_list_workspaces', not: true },
      required: true,
    },
    {
      id: 'reportSelector',
      title: 'Report',
      type: 'project-selector',
      canonicalParamId: 'reportId',
      selectorKey: 'powerbi.reports',
      serviceId: 'microsoft-powerbi',
      placeholder: 'Select report',
      dependsOn: ['oauthCredential', 'groupId'],
      mode: 'basic',
      condition: { field: 'operation', value: 'powerbi_get_report' },
      required: true,
    },
    {
      id: 'manualReportId',
      title: 'Report',
      type: 'short-input',
      canonicalParamId: 'reportId',
      placeholder: 'Enter report ID',
      dependsOn: ['oauthCredential', 'groupId'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_get_report' },
      required: true,
    },
    {
      id: 'datasetSelector',
      title: 'Semantic Model',
      type: 'project-selector',
      canonicalParamId: 'datasetId',
      selectorKey: 'powerbi.datasets',
      serviceId: 'microsoft-powerbi',
      placeholder: 'Select semantic model',
      dependsOn: ['oauthCredential', 'groupId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'powerbi_get_dataset',
          'powerbi_execute_query',
          'powerbi_refresh_dataset',
          'powerbi_get_refresh_history',
        ],
      },
      required: true,
    },
    {
      id: 'manualDatasetId',
      title: 'Semantic Model',
      type: 'short-input',
      canonicalParamId: 'datasetId',
      placeholder: 'Enter semantic model ID',
      dependsOn: ['oauthCredential', 'groupId'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'powerbi_get_dataset',
          'powerbi_execute_query',
          'powerbi_refresh_dataset',
          'powerbi_get_refresh_history',
        ],
      },
      required: true,
    },
    {
      id: 'query',
      title: 'DAX Query',
      type: 'long-input',
      placeholder: 'EVALUATE ROW("KPI", [Your Measure])',
      rows: 6,
      condition: { field: 'operation', value: 'powerbi_execute_query' },
      required: true,
      tooltip:
        'Run one DAX query returning one table. Requires model Read and Build permissions and the tenant Execute Queries setting. SQL, INFO functions, and DMV queries are unsupported.',
      wandConfig: {
        enabled: true,
        prompt:
          'Write one Power BI DAX query returning one table using EVALUATE. Use only the model table, column, and measure names supplied by the user; ask for missing schema instead of inventing names. Prefer summaries or TOPN to keep results small. Do not use SQL, MDX, INFO functions, or DMV queries. Return ONLY the DAX query without markdown or explanation.',
        placeholder: 'Describe the measures, filters, and known model fields...',
      },
    },
    {
      id: 'includeNulls',
      title: 'Include Nulls',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_execute_query' },
      tooltip: 'Include blank values as null in query result rows. Enabled by default.',
    },
    {
      id: 'notifyOption',
      title: 'Refresh Notifications',
      type: 'dropdown',
      options: [
        { label: 'No Notification', id: 'NoNotification' },
        { label: 'Email on Failure', id: 'MailOnFailure' },
        { label: 'Email on Completion', id: 'MailOnCompletion' },
      ],
      value: () => 'NoNotification',
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_refresh_dataset' },
      tooltip:
        'Request a standard refresh and return immediately. Check Get Refresh History separately for completion.',
    },
    {
      id: 'workspaceTop',
      title: 'Maximum Workspaces',
      type: 'short-input',
      placeholder: 'Defaults to 100',
      value: () => '100',
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_list_workspaces' },
    },
    {
      id: 'workspaceSkip',
      title: 'Workspace Offset',
      type: 'short-input',
      placeholder: 'Defaults to 0',
      value: () => '0',
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_list_workspaces' },
    },
    {
      id: 'workspaceFilter',
      title: 'Workspace Filter',
      type: 'short-input',
      placeholder: "name eq 'Sales'",
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_list_workspaces' },
      tooltip: 'Optional OData filter on accessible workspaces.',
      wandConfig: {
        enabled: true,
        generationType: 'odata-expression',
        prompt:
          "Write an OData $filter expression for the Power BI Get Groups API using workspace names. Use the documented patterns name eq 'Sales', contains(name,'Sales'), or combinations with or. Return ONLY the filter expression, without $filter= or markdown.",
        placeholder: 'Describe which workspace names to include...',
      },
    },
    {
      id: 'refreshHistoryTop',
      title: 'Maximum Refreshes',
      type: 'short-input',
      placeholder: 'Defaults to 60',
      value: () => '60',
      mode: 'advanced',
      condition: { field: 'operation', value: 'powerbi_get_refresh_history' },
    },
  ],
  tools: {
    access: [
      'powerbi_list_workspaces',
      'powerbi_list_reports',
      'powerbi_get_report',
      'powerbi_list_datasets',
      'powerbi_get_dataset',
      'powerbi_execute_query',
      'powerbi_refresh_dataset',
      'powerbi_get_refresh_history',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        switch (params.operation) {
          case 'powerbi_list_workspaces':
            return {
              top:
                parseOptionalNumberInput(params.workspaceTop, 'Maximum workspaces', {
                  integer: true,
                  min: 0,
                }) ?? 100,
              skip:
                parseOptionalNumberInput(params.workspaceSkip, 'Workspace offset', {
                  integer: true,
                  min: 0,
                }) ?? 0,
              filter: params.workspaceFilter,
            }
          case 'powerbi_get_refresh_history':
            return {
              top:
                parseOptionalNumberInput(params.refreshHistoryTop, 'Maximum refreshes', {
                  integer: true,
                  min: 1,
                }) ?? 60,
            }
          case 'powerbi_execute_query':
            return { includeNulls: parseIncludeNulls(params.includeNulls) }
          case 'powerbi_refresh_dataset':
            return { notifyOption: params.notifyOption || 'NoNotification' }
          default:
            return {}
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Power BI action to perform' },
    oauthCredential: { type: 'string', description: 'Delegated Power BI credential ID' },
    groupId: { type: 'string', description: 'Workspace ID' },
    datasetId: { type: 'string', description: 'Semantic model ID' },
    reportId: { type: 'string', description: 'Report ID' },
    query: { type: 'string', description: 'One DAX query returning one table' },
    includeNulls: { type: 'boolean', description: 'Include null query values; defaults to true' },
    notifyOption: { type: 'string', description: 'Standard refresh notification option' },
    workspaceTop: { type: 'number', description: 'Maximum workspaces; defaults to 100' },
    workspaceSkip: { type: 'number', description: 'Workspace offset; defaults to 0' },
    workspaceFilter: { type: 'string', description: 'Optional OData workspace filter' },
    refreshHistoryTop: { type: 'number', description: 'Maximum refresh entries; defaults to 60' },
  },
  outputs: {
    workspaces: {
      type: 'json',
      description: 'Accessible workspaces with ID, name, read-only state, and capacity metadata',
      condition: { field: 'operation', value: 'powerbi_list_workspaces' },
    },
    workspaceCount: {
      type: 'number',
      description: 'Workspaces in this response page',
      condition: { field: 'operation', value: 'powerbi_list_workspaces' },
    },
    reports: {
      type: 'json',
      description: 'Reports with ID, name, report type, URLs, and optional semantic model ID',
      condition: { field: 'operation', value: 'powerbi_list_reports' },
    },
    reportCount: {
      type: 'number',
      description: 'Reports returned',
      condition: { field: 'operation', value: 'powerbi_list_reports' },
    },
    report: {
      type: 'json',
      description: 'Report details including ID, name, report type, URLs, and semantic model ID',
      condition: { field: 'operation', value: 'powerbi_get_report' },
    },
    datasets: {
      type: 'json',
      description: 'Semantic models with ID, name, and metadata available to the connected user',
      condition: { field: 'operation', value: 'powerbi_list_datasets' },
    },
    datasetCount: {
      type: 'number',
      description: 'Semantic models returned',
      condition: { field: 'operation', value: 'powerbi_list_datasets' },
    },
    dataset: {
      type: 'json',
      description:
        'Semantic model ID, name, owner, creation date, refreshability, and identity metadata',
      condition: { field: 'operation', value: 'powerbi_get_dataset' },
    },
    rows: {
      type: 'json',
      description: 'Rows from a successful query, preserving DAX column names',
      condition: { field: 'operation', value: 'powerbi_execute_query' },
    },
    rowCount: {
      type: 'number',
      description: 'Number of returned query rows',
      condition: { field: 'operation', value: 'powerbi_execute_query' },
    },
    errors: {
      type: 'json',
      description: 'Query errors from response, result, or table levels, with code and message',
      condition: { field: 'operation', value: 'powerbi_execute_query' },
    },
    incomplete: {
      type: 'boolean',
      description: 'Whether query errors mean returned rows are incomplete',
      condition: { field: 'operation', value: 'powerbi_execute_query' },
    },
    informationProtectionLabel: {
      type: 'json',
      description: 'Semantic model information-protection label ID and name, or null',
      condition: { field: 'operation', value: 'powerbi_execute_query' },
    },
    accepted: {
      type: 'boolean',
      description:
        'Whether Power BI accepted the refresh request; this does not confirm completion',
      condition: { field: 'operation', value: 'powerbi_refresh_dataset' },
    },
    requestId: {
      type: 'string',
      description: 'Refresh request ID returned by Power BI, or null',
      condition: { field: 'operation', value: 'powerbi_refresh_dataset' },
    },
    location: {
      type: 'string',
      description: 'Refresh request location returned by Power BI, or null; use history for status',
      condition: { field: 'operation', value: 'powerbi_refresh_dataset' },
    },
    refreshes: {
      type: 'json',
      description:
        'Refresh entries with request ID, type, status, timestamps, errors, and attempts',
      condition: { field: 'operation', value: 'powerbi_get_refresh_history' },
    },
    refreshCount: {
      type: 'number',
      description: 'Refresh history entries returned',
      condition: { field: 'operation', value: 'powerbi_get_refresh_history' },
    },
  },
}

export const PowerBIBlockMeta = {
  tags: ['data-analytics', 'microsoft-365', 'automation'],
  url: 'https://www.microsoft.com/en-us/power-platform/products/power-bi',
  templates: [
    {
      icon: PowerBIIcon,
      title: 'Power BI KPI briefing',
      prompt:
        "Build a scheduled workflow that runs an approved DAX query for daily KPIs in a Power BI semantic model, summarizes successful results, and posts the briefing to Microsoft Teams. Connect the query block's error port to a separate failure notification.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analytics', 'reporting'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: PowerBIIcon,
      title: 'Power BI sales target alert',
      prompt:
        'Create a scheduled workflow that queries approved sales and target measures from a Power BI semantic model, compares complete results with a configured threshold, and alerts the sales team in Slack when the target is missed.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analytics'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PowerBIIcon,
      title: 'Power BI report catalog',
      prompt:
        'Build a scheduled workflow that lists accessible Power BI workspaces and their reports, collects report links and semantic model IDs when available, and updates a Sim table as a searchable report catalog.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['inventory', 'reporting'],
    },
    {
      icon: PowerBIIcon,
      title: 'Power BI model inventory',
      prompt:
        'Create a scheduled workflow that inventories semantic models in selected accessible workspaces, records names and available owner and refresh metadata in a Sim table, and summarizes missing metadata without assuming read-only responses are complete.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['inventory', 'governance'],
    },
    {
      icon: PowerBIIcon,
      title: 'Power BI pipeline refresh',
      prompt:
        'Build a workflow started by an upstream pipeline completion request that asks Power BI to refresh a selected semantic model and records the acceptance and request ID in a Sim table. Notify Microsoft Teams that the refresh was requested, then use a separate scheduled history check to observe completion.',
      modules: ['tables', 'workflows', 'scheduled'],
      category: 'engineering',
      tags: ['automation', 'data-pipeline'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: PowerBIIcon,
      title: 'Power BI refresh failure monitor',
      prompt:
        'Create a scheduled workflow that retrieves refresh history for critical Power BI semantic models, identifies failed requests and their error details, and notifies an operations Slack channel once per request ID using a Sim table to track previously reported failures.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'incident-management'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PowerBIIcon,
      title: 'Power BI freshness watch',
      prompt:
        'Build a scheduled workflow that reads semantic model refresh history, compares the most recent completed refresh with an agreed freshness deadline, and sends Microsoft Teams a stale-data warning when the deadline is missed. Report Unknown statuses separately without claiming a refresh has completed.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'data-quality'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'summarize-semantic-model-kpis',
      description:
        'Run an approved DAX query and turn complete semantic model results into a KPI summary.',
      content:
        "# Summarize Semantic Model KPIs\n\n## Steps\n1. Select an accessible workspace and semantic model. Ask for known measure names or an approved query; these actions do not discover the model schema.\n2. Use Execute DAX Query with one EVALUATE query returning one table. Keep the result small and include nulls when blanks matter.\n3. Summarize only successful query results. Connect the query block's error port to a failure notification using its error output; partial rows are unavailable on the workflow error path.\n\n## Output\nKPI values and their model context on success, or a separate query failure notification.\n\n## Sources\n[Microsoft DAX queries](https://learn.microsoft.com/en-us/dax/dax-queries) · [Execute Queries API](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries-in-group)",
    },
    {
      name: 'inventory-workspace-reports',
      description:
        'Catalog accessible workspace reports and links without assuming every report has a semantic model.',
      content:
        '# Inventory Workspace Reports\n\n## Steps\n1. Use List Workspaces for the connected user, advancing the numeric offset for subsequent pages when needed.\n2. Use List Reports in each selected workspace. Use Get Report for a specific report.\n3. Record IDs, names, report types, and available URLs. Paginated reports may have no semantic model ID; keep that value null.\n\n## Output\nA catalog limited to the workspaces the account can access.\n\n## Sources\n[Get Groups](https://learn.microsoft.com/en-us/rest/api/power-bi/groups/get-groups) · [Get Reports in Group](https://learn.microsoft.com/en-us/rest/api/power-bi/reports/get-reports-in-group)',
    },
    {
      name: 'inventory-semantic-models',
      description:
        'List semantic models and describe only the metadata available to the connected account.',
      content:
        '# Inventory Semantic Models\n\n## Steps\n1. Select an accessible workspace and use List Semantic Models.\n2. Use Get Semantic Model for details of a chosen model.\n3. Record model identity and available metadata. A read-only response can contain only ID and name; missing fields do not mean false. The refreshability flag does not prove permission to refresh.\n\n## Output\nA model inventory with explicit unknown metadata.\n\n## Source\n[Get Datasets in Group](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/get-datasets-in-group)',
    },
    {
      name: 'request-semantic-model-refresh',
      description:
        'Request a standard semantic model refresh and record acceptance for later monitoring.',
      content:
        '# Request Semantic Model Refresh\n\n## Steps\n1. Confirm the workspace and semantic model to refresh.\n2. Use Refresh Semantic Model with the selected notification option. No Notification is the default.\n3. Record accepted, requestId, and location. Acceptance is not completion; use Get Refresh History later. Do not automatically resubmit an ambiguous request failure.\n\n## Output\nRefresh acceptance and the provider request ID when supplied.\n\n## Source\n[Refresh Dataset in Group](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/refresh-dataset-in-group)',
    },
    {
      name: 'monitor-refresh-health',
      description:
        'Inspect refresh history for failed requests and summarize their attempts and errors.',
      content:
        '# Monitor Refresh Health\n\n## Steps\n1. Use Get Refresh History for a selected semantic model with model Write permission.\n2. Inspect request IDs, statuses, timestamps, service exceptions, and refresh attempts. Unknown does not confirm completion.\n3. Report failed requests with available error details and avoid duplicate alerts by retaining previously reported request IDs.\n\n## Output\nA refresh health summary with failed requests and unresolved statuses.\n\n## Sources\n[Get Refresh History](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/get-refresh-history-in-group) · [Microsoft refresh monitoring guidance](https://learn.microsoft.com/en-us/power-bi/guidance/powerbi-implementation-planning-auditing-monitoring-data-level-auditing)',
    },
    {
      name: 'check-data-freshness',
      description:
        'Compare completed refresh history with a freshness deadline before distributing a KPI report.',
      content:
        '# Check Data Freshness\n\n## Steps\n1. Retrieve enough recent refresh history for the chosen semantic model.\n2. Find the most recent completed refresh with an end time and compare it with the agreed freshness deadline.\n3. Report stale or unknown freshness before publishing a KPI briefing. Refresh history does not include OneDrive refreshes or all refresh warnings.\n\n## Output\nThe last observed completed refresh and whether it meets the deadline.\n\n## Source\n[Microsoft data refresh guidance](https://learn.microsoft.com/en-us/power-bi/connect-data/refresh-data)',
    },
  ],
} as const satisfies BlockMeta
