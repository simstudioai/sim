import { HexIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { HexResponse } from '@/tools/hex/types'

export const HexBlock: BlockConfig<HexResponse> = {
  type: 'hex',
  name: 'Hex',
  description: 'Run and manage Hex projects',
  longDescription:
    'Integrate Hex into your workflow. Run projects, check run status, manage collections and groups, list users, and view data connections. Requires a Hex API token.',
  docsLink: 'https://docs.sim.ai/tools/hex',
  category: 'tools',
  bgColor: '#F5E6FF',
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
        if (params.limit) result.limit = Number(params.limit)
        if (params.offset) result.offset = Number(params.offset)
        if (params.projectStatus) result.status = params.projectStatus
        if (params.runStatusFilter) result.statusFilter = params.runStatusFilter
        if (params.groupIdInput) result.groupId = params.groupIdInput
        if (params.collectionName) result.name = params.collectionName
        if (params.collectionDescription) result.description = params.collectionDescription
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
