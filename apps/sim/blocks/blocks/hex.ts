import { HexIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { HexResponse } from '@/tools/hex/types'

export const HexBlock: BlockConfig<HexResponse> = {
  type: 'hex',
  name: 'Hex',
  description: 'Run and manage Hex projects',
  longDescription:
    'Integrate Hex into your workflow. Run projects, check run status, manage collections and groups, list users, and view data connections. Requires a Hex API token.',
  docsLink: 'https://docs.sim.ai/integrations/hex',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#14151A',
  icon: HexIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Project', id: 'run_project' },
        { label: 'Get Run Status', id: 'get_run_status' },
        { label: 'Get Project Runs', id: 'get_project_runs' },
        { label: 'Cancel Run', id: 'cancel_run' },
        { label: 'List Projects', id: 'list_projects' },
        { label: 'Get Project', id: 'get_project' },
        { label: 'Update Project', id: 'update_project' },
        { label: 'Get Queried Tables', id: 'get_queried_tables' },
        { label: 'List Users', id: 'list_users' },
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Get Group', id: 'get_group' },
        { label: 'List Collections', id: 'list_collections' },
        { label: 'Get Collection', id: 'get_collection' },
        { label: 'Create Collection', id: 'create_collection' },
        { label: 'List Data Connections', id: 'list_data_connections' },
        { label: 'Get Data Connection', id: 'get_data_connection' },
      ],
      value: () => 'run_project',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter project UUID',
      condition: {
        field: 'operation',
        value: [
          'run_project',
          'get_run_status',
          'get_project_runs',
          'cancel_run',
          'get_project',
          'update_project',
          'get_queried_tables',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'run_project',
          'get_run_status',
          'get_project_runs',
          'cancel_run',
          'get_project',
          'update_project',
          'get_queried_tables',
        ],
      },
    },
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'Enter run UUID',
      condition: { field: 'operation', value: ['get_run_status', 'cancel_run'] },
      required: { field: 'operation', value: ['get_run_status', 'cancel_run'] },
    },
    {
      id: 'inputParams',
      title: 'Input Parameters',
      type: 'code',
      placeholder: '{"param_name": "value"}',
      condition: { field: 'operation', value: 'run_project' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert at creating Hex project input parameters.
Generate ONLY the raw JSON object based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.

Current parameters: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.
The keys should match the input parameter names defined in the Hex project.

Example:
{
  "date_range": "2024-01-01",
  "department": "engineering",
  "include_inactive": false
}`,
        placeholder: 'Describe the input parameters you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'projectStatus',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Enter status name (e.g., custom workspace status label)',
      condition: { field: 'operation', value: 'update_project' },
      required: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'runStatusFilter',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Running', id: 'RUNNING' },
        { label: 'Completed', id: 'COMPLETED' },
        { label: 'Errored', id: 'ERRORED' },
        { label: 'Killed', id: 'KILLED' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'get_project_runs' },
    },
    {
      id: 'groupIdInput',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Enter group UUID',
      condition: { field: 'operation', value: 'get_group' },
      required: { field: 'operation', value: 'get_group' },
    },
    {
      id: 'collectionId',
      title: 'Collection ID',
      type: 'short-input',
      placeholder: 'Enter collection UUID',
      condition: { field: 'operation', value: 'get_collection' },
      required: { field: 'operation', value: 'get_collection' },
    },
    {
      id: 'collectionName',
      title: 'Collection Name',
      type: 'short-input',
      placeholder: 'Enter collection name',
      condition: { field: 'operation', value: 'create_collection' },
      required: { field: 'operation', value: 'create_collection' },
    },
    {
      id: 'collectionDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Optional description for the collection',
      condition: { field: 'operation', value: 'create_collection' },
    },
    {
      id: 'dataConnectionId',
      title: 'Data Connection ID',
      type: 'short-input',
      placeholder: 'Enter data connection UUID',
      condition: { field: 'operation', value: 'get_data_connection' },
      required: { field: 'operation', value: 'get_data_connection' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Hex API token',
      password: true,
      required: true,
    },
    // Advanced fields
    {
      id: 'dryRun',
      title: 'Dry Run',
      type: 'switch',
      condition: { field: 'operation', value: 'run_project' },
      mode: 'advanced',
    },
    {
      id: 'updateCache',
      title: 'Update Cache',
      type: 'switch',
      condition: { field: 'operation', value: 'run_project' },
      mode: 'advanced',
    },
    {
      id: 'updatePublishedResults',
      title: 'Update Published Results',
      type: 'switch',
      condition: { field: 'operation', value: 'run_project' },
      mode: 'advanced',
    },
    {
      id: 'useCachedSqlResults',
      title: 'Use Cached SQL Results',
      type: 'switch',
      condition: { field: 'operation', value: 'run_project' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: [
          'list_projects',
          'get_project_runs',
          'get_queried_tables',
          'list_users',
          'list_groups',
          'list_collections',
          'list_data_connections',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'get_project_runs' },
      mode: 'advanced',
    },
    {
      id: 'includeArchived',
      title: 'Include Archived',
      type: 'switch',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'statusFilter',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Published', id: 'PUBLISHED' },
        { label: 'Draft', id: 'DRAFT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'groupId',
      title: 'Filter by Group',
      type: 'short-input',
      placeholder: 'Group UUID (optional)',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'hex_cancel_run',
      'hex_create_collection',
      'hex_get_collection',
      'hex_get_data_connection',
      'hex_get_group',
      'hex_get_project',
      'hex_get_project_runs',
      'hex_get_queried_tables',
      'hex_get_run_status',
      'hex_list_collections',
      'hex_list_data_connections',
      'hex_list_groups',
      'hex_list_projects',
      'hex_list_users',
      'hex_run_project',
      'hex_update_project',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'run_project':
            return 'hex_run_project'
          case 'get_run_status':
            return 'hex_get_run_status'
          case 'get_project_runs':
            return 'hex_get_project_runs'
          case 'cancel_run':
            return 'hex_cancel_run'
          case 'list_projects':
            return 'hex_list_projects'
          case 'get_project':
            return 'hex_get_project'
          case 'update_project':
            return 'hex_update_project'
          case 'get_queried_tables':
            return 'hex_get_queried_tables'
          case 'list_users':
            return 'hex_list_users'
          case 'list_groups':
            return 'hex_list_groups'
          case 'get_group':
            return 'hex_get_group'
          case 'list_collections':
            return 'hex_list_collections'
          case 'get_collection':
            return 'hex_get_collection'
          case 'create_collection':
            return 'hex_create_collection'
          case 'list_data_connections':
            return 'hex_list_data_connections'
          case 'get_data_connection':
            return 'hex_get_data_connection'
          default:
            return 'hex_run_project'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        const op = params.operation

        if (params.limit) result.limit = Number(params.limit)
        if (op === 'get_project_runs' && params.offset) result.offset = Number(params.offset)
        if (op === 'update_project' && params.projectStatus) result.status = params.projectStatus
        if (op === 'get_project_runs' && params.runStatusFilter)
          result.statusFilter = params.runStatusFilter
        if (op === 'get_group' && params.groupIdInput) result.groupId = params.groupIdInput
        if (op === 'list_users' && params.groupId) result.groupId = params.groupId
        if (op === 'create_collection' && params.collectionName) result.name = params.collectionName
        if (op === 'create_collection' && params.collectionDescription)
          result.description = params.collectionDescription

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Hex API token' },
    projectId: { type: 'string', description: 'Project UUID' },
    runId: { type: 'string', description: 'Run UUID' },
    inputParams: { type: 'json', description: 'Input parameters for project run' },
    dryRun: { type: 'boolean', description: 'Perform a dry run without executing the project' },
    updateCache: {
      type: 'boolean',
      description: '(Deprecated) Update cached results after execution',
    },
    updatePublishedResults: {
      type: 'boolean',
      description: 'Update published app results after execution',
    },
    useCachedSqlResults: {
      type: 'boolean',
      description: 'Use cached SQL results instead of re-running queries',
    },
    projectStatus: {
      type: 'string',
      description: 'New project status name (custom workspace status label)',
    },
    limit: { type: 'number', description: 'Max number of results to return' },
    offset: { type: 'number', description: 'Offset for paginated results' },
    includeArchived: { type: 'boolean', description: 'Include archived projects' },
    statusFilter: { type: 'string', description: 'Filter projects by status' },
    runStatusFilter: { type: 'string', description: 'Filter runs by status' },
    groupId: { type: 'string', description: 'Filter users by group UUID' },
    groupIdInput: { type: 'string', description: 'Group UUID for get group' },
    collectionId: { type: 'string', description: 'Collection UUID' },
    collectionName: { type: 'string', description: 'Collection name' },
    collectionDescription: { type: 'string', description: 'Collection description' },
    dataConnectionId: { type: 'string', description: 'Data connection UUID' },
  },

  outputs: {
    // Run creation outputs
    projectId: { type: 'string', description: 'Project UUID' },
    runId: { type: 'string', description: 'Run UUID' },
    runUrl: { type: 'string', description: 'URL to view the run' },
    runStatusUrl: { type: 'string', description: 'URL to check run status' },
    projectVersion: { type: 'number', description: 'Project version number' },
    // Run status outputs
    status: {
      type: 'json',
      description: 'Project status object ({ name }) or run status string',
    },
    startTime: { type: 'string', description: 'Run start time' },
    endTime: { type: 'string', description: 'Run end time' },
    elapsedTime: { type: 'number', description: 'Elapsed time in seconds' },
    traceId: { type: 'string', description: 'Trace ID for debugging' },
    // Project outputs
    id: { type: 'string', description: 'Resource ID' },
    title: { type: 'string', description: 'Project title' },
    name: { type: 'string', description: 'Resource name' },
    description: { type: 'string', description: 'Resource description' },
    type: { type: 'string', description: 'Project type (PROJECT or COMPONENT)' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    lastEditedAt: { type: 'string', description: 'Last edited timestamp' },
    lastPublishedAt: { type: 'string', description: 'Last published timestamp' },
    archivedAt: { type: 'string', description: 'Archived timestamp' },
    trashedAt: { type: 'string', description: 'Trashed timestamp' },
    // List outputs
    projects: {
      type: 'json',
      description: 'List of projects with id, title, status, type, creator, owner, createdAt',
    },
    runs: {
      type: 'json',
      description:
        'List of runs with runId, status, runUrl, startTime, endTime, elapsedTime, projectVersion',
    },
    users: { type: 'json', description: 'List of users with id, name, email, role' },
    groups: { type: 'json', description: 'List of groups with id, name, createdAt' },
    collections: {
      type: 'json',
      description: 'List of collections with id, name, description, creator',
    },
    connections: {
      type: 'json',
      description:
        'List of data connections with id, name, type, description, connectViaSsh, includeMagic, allowWritebackCells',
    },
    tables: {
      type: 'json',
      description: 'List of queried tables with dataConnectionId, dataConnectionName, tableName',
    },
    categories: {
      type: 'json',
      description: 'Project categories with name and description',
    },
    creator: { type: 'json', description: 'Creator details ({ email, id })' },
    owner: { type: 'json', description: 'Owner details ({ email })' },
    total: { type: 'number', description: 'Total results returned' },
    // Cancel output
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    // Data connection flags
    connectViaSsh: { type: 'boolean', description: 'SSH tunneling enabled' },
    includeMagic: { type: 'boolean', description: 'Magic AI features enabled' },
    allowWritebackCells: { type: 'boolean', description: 'Writeback cells allowed' },
  },
}

export const HexBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://hex.tech',
  templates: [
    {
      icon: HexIcon,
      title: 'Hex project notebook runner',
      prompt:
        'Create a scheduled workflow that runs a Hex notebook with parameters every morning, waits for the run to finish, and posts a summary with the published notebook link to a Slack data channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HexIcon,
      title: 'Hex anomaly digest',
      prompt:
        'Build a workflow that runs a Hex notebook for anomaly detection on key metrics nightly, captures detected anomalies into a table, and pages the on-call data team on Slack for severe deltas.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HexIcon,
      title: 'Hex executive metrics email',
      prompt:
        'Create a scheduled weekly workflow that runs a Hex executive dashboard notebook, summarizes the run results, and emails a snapshot with the dashboard link to the leadership distribution list every Monday morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: HexIcon,
      title: 'Hex + Tinybird realtime data app',
      prompt:
        'Create a workflow that powers a Hex data app with Tinybird realtime data, refreshes the dashboard on schedule, and writes usage analytics to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['tinybird'],
    },
    {
      icon: HexIcon,
      title: 'Hex + Stripe revenue notebook',
      prompt:
        'Build a scheduled workflow that runs a Hex notebook over Stripe payment data daily, captures MRR, churn, and expansion metrics, and posts a summary with the notebook link to a Slack data channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['stripe', 'slack'],
    },
    {
      icon: HexIcon,
      title: 'Hex + Amplitude product notebook',
      prompt:
        'Create a scheduled workflow that runs a Hex notebook joining Amplitude data with internal sources weekly, captures retention and feature adoption, and emails a summary with the notebook link to the product team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['amplitude', 'gmail'],
    },
    {
      icon: HexIcon,
      title: 'Hex run failure monitor',
      prompt:
        'Build a workflow that lists recent Hex project runs every hour, checks each run status, and when a scheduled notebook fails pulls the error, summarizes the likely cause with an agent, and posts a Slack alert with a link to the run.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'analysis'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'run-project-with-params',
      description: 'Trigger a Hex project run with input parameters and poll until it completes.',
      content:
        '# Run Project With Params\n\nKick off a Hex project and wait for the result.\n\n## Steps\n1. If only a project name is known, list projects to resolve the project ID.\n2. Run the project, passing any input parameters the project expects.\n3. Capture the run ID and poll the run status until it reaches a terminal state (completed, errored, or killed).\n4. If it is still pending after a reasonable timeout, report the current status rather than blocking indefinitely.\n\n## Output\nReturn the run ID, final status, and any output or result link. On error, include the failure reason.',
    },
    {
      name: 'monitor-recent-runs',
      description: 'List recent Hex project runs, check their statuses, and surface failures.',
      content:
        '# Monitor Recent Runs\n\nWatch project runs and flag the ones that failed.\n\n## Steps\n1. List project runs for the relevant project or projects.\n2. Get the run status for each recent run.\n3. Filter to runs that errored or were killed and capture the error detail.\n4. Group successes and failures with timestamps.\n\n## Output\nReturn a summary of recent runs with status and timing, plus a flagged failures section with run IDs, error messages, and links. Suitable for an hourly monitoring digest.',
    },
    {
      name: 'cancel-stuck-run',
      description: 'Find a long-running or stuck Hex run and cancel it.',
      content:
        '# Cancel Stuck Run\n\nStop a run that is hung or no longer needed.\n\n## Steps\n1. List project runs and get the status of in-progress runs.\n2. Identify runs exceeding an expected duration or explicitly targeted for cancellation.\n3. Cancel the run by its run ID.\n4. Re-check the status to confirm cancellation took effect.\n\n## Output\nReturn the cancelled run ID and its confirmed final status. Note any run that could not be cancelled.',
    },
    {
      name: 'inventory-projects',
      description: 'List Hex projects, collections, and data connections to map analytics assets.',
      content:
        '# Inventory Projects\n\nMap what projects and data sources exist in the workspace.\n\n## Steps\n1. List projects and capture IDs, names, and owners.\n2. List collections and get details to see how projects are grouped.\n3. List data connections to map which sources power the projects.\n4. Cross-reference projects to their collections and data connections.\n\n## Output\nReturn an inventory of projects grouped by collection, each annotated with its data connections. Useful for governance and cleanup.',
    },
  ],
} as const satisfies BlockMeta
