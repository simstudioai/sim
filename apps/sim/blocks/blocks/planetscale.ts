import { PlanetScaleIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Expected a boolean')
}
function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : Number(value)
}
export const PlanetScaleBlock: BlockConfig = {
  type: 'planetscale',
  name: 'PlanetScale',
  description: 'Manage PlanetScale databases, branches, backups, and deploy requests',
  longDescription:
    'Manage PlanetScale databases and branches, create and inspect backups, and create, review, queue, and close Vitess deploy requests. Authenticate with an organization service token. Deploy-request actions require a Vitess database; SQL queries are available through the MySQL and PostgreSQL integrations.',
  docsLink: 'https://docs.sim.ai/integrations/planetscale',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  authMode: AuthMode.ApiKey,
  bgColor: '#111111',
  icon: PlanetScaleIcon,
  canvasPresentation: {
    defaultTitle: 'PlanetScale',
    sentences: {
      byOperation: {
        list_databases: ['List databases', { text: 'in', field: 'organization', core: true }],
        get_database: [
          { text: 'Read database', field: ['databaseSelector', 'manualDatabase'], core: true },
        ],
        list_branches: [
          { text: 'List branches in', field: ['databaseSelector', 'manualDatabase'], core: true },
        ],
        get_branch: [{ text: 'Get branch', field: ['branchSelector', 'manualBranch'], core: true }],
        create_branch: [
          { text: 'Create branch', field: 'name', core: true },
          { text: 'from', field: ['parentBranchSelector', 'manualParentBranch'] },
        ],
        delete_branch: [
          { text: 'Delete branch', field: ['branchSelector', 'manualBranch'], core: true },
        ],
        list_backups: [
          { text: 'List backups for', field: ['branchSelector', 'manualBranch'], core: true },
        ],
        get_backup: [
          { text: 'Read backup', field: ['backupIdSelector', 'manualBackupId'], core: true },
        ],
        create_backup: [
          { text: 'Create backup for', field: ['branchSelector', 'manualBranch'], core: true },
        ],
        list_deploy_requests: [
          {
            text: 'List deploy requests in',
            field: ['databaseSelector', 'manualDatabase'],
            core: true,
          },
        ],
        get_deploy_request: [
          {
            text: 'Get deploy request',
            field: ['deployRequestNumberSelector', 'manualDeployRequestNumber'],
            core: true,
          },
        ],
        create_deploy_request: [
          {
            text: 'Create deploy request from',
            field: ['branchSelector', 'manualBranch'],
            core: true,
          },
          { text: 'into', field: ['intoBranchSelector', 'manualIntoBranch'], core: true },
        ],
        review_deploy_request: [
          {
            text: 'Review deploy request',
            field: ['deployRequestNumberSelector', 'manualDeployRequestNumber'],
            core: true,
          },
        ],
        queue_deploy_request: [
          {
            text: 'Queue deploy request',
            field: ['deployRequestNumberSelector', 'manualDeployRequestNumber'],
            core: true,
          },
        ],
        close_deploy_request: [
          {
            text: 'Close deploy request',
            field: ['deployRequestNumberSelector', 'manualDeployRequestNumber'],
            core: true,
          },
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
        { id: 'list_databases', label: 'List Databases' },
        { id: 'get_database', label: 'Get Database' },
        { id: 'list_branches', label: 'List Branches' },
        { id: 'get_branch', label: 'Get Branch' },
        { id: 'create_branch', label: 'Create Branch' },
        { id: 'delete_branch', label: 'Delete Branch' },
        { id: 'list_backups', label: 'List Backups' },
        { id: 'get_backup', label: 'Get Backup' },
        { id: 'create_backup', label: 'Create Backup' },
        { id: 'list_deploy_requests', label: 'List Deploy Requests (Vitess)' },
        { id: 'get_deploy_request', label: 'Get Deploy Request (Vitess)' },
        { id: 'create_deploy_request', label: 'Create Deploy Request (Vitess)' },
        { id: 'review_deploy_request', label: 'Review Deploy Request (Vitess)' },
        { id: 'queue_deploy_request', label: 'Queue Deploy Request (Vitess)' },
        { id: 'close_deploy_request', label: 'Close Deploy Request (Vitess)' },
      ],
      value: () => 'list_databases',
    },
    {
      id: 'serviceTokenId',
      title: 'Service Token ID',
      type: 'short-input',
      placeholder: 'Enter your service token ID',
      password: true,
      required: true,
      paramVisibility: 'user-only',
    },
    {
      id: 'serviceToken',
      title: 'Service Token',
      type: 'short-input',
      placeholder: 'Enter your service token',
      password: true,
      required: true,
      paramVisibility: 'user-only',
    },
    {
      id: 'organization',
      title: 'Organization',
      type: 'short-input',
      placeholder: 'Enter your organization slug',
      required: true,
    },
    {
      id: 'q',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter by name',
      condition: { field: 'operation', value: ['list_databases', 'list_branches'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: ['list_databases', 'list_branches', 'list_backups', 'list_deploy_requests'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'perPage',
      title: 'Per Page',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: ['list_databases', 'list_branches', 'list_backups', 'list_deploy_requests'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'databaseSelector',
      title: 'Database',
      type: 'file-selector',
      canonicalParamId: 'database',
      selectorKey: 'planetscale.databases',
      dependsOn: ['serviceTokenId', 'serviceToken', 'organization'],
      placeholder: 'Select database',
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'get_database',
          'list_branches',
          'create_branch',
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'list_deploy_requests',
          'create_deploy_request',
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_database',
          'list_branches',
          'create_branch',
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'list_deploy_requests',
          'create_deploy_request',
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
    },
    {
      id: 'manualDatabase',
      title: 'Database',
      type: 'short-input',
      placeholder: 'Enter database name',
      canonicalParamId: 'database',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'get_database',
          'list_branches',
          'create_branch',
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'list_deploy_requests',
          'create_deploy_request',
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_database',
          'list_branches',
          'create_branch',
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'list_deploy_requests',
          'create_deploy_request',
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
    },
    {
      id: 'production',
      title: 'Production',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_branches', 'list_backups'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'safeMigrations',
      title: 'Safe Migrations',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_branches'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_branches'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Asc', id: 'asc' },
        { label: 'Desc', id: 'desc' },
      ],
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter a name',
      condition: { field: 'operation', value: ['create_branch', 'create_backup'] },
      required: { field: 'operation', value: ['create_branch'] },
    },
    {
      id: 'deletionProtected',
      title: 'Deletion Protected',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'parentBranchSelector',
      title: 'Parent Branch',
      type: 'file-selector',
      canonicalParamId: 'parentBranch',
      selectorKey: 'planetscale.branches',
      dependsOn: ['serviceTokenId', 'serviceToken', 'organization', 'databaseSelector'],
      placeholder: 'Select parent branch',
      mode: 'basic',
      required: false,
      condition: { field: 'operation', value: ['create_branch'] },
    },
    {
      id: 'manualParentBranch',
      title: 'Parent Branch Name',
      type: 'short-input',
      placeholder: 'Defaults to the default branch',
      canonicalParamId: 'parentBranch',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['create_branch'] },
    },
    {
      id: 'backupIdSelector',
      title: 'Backup',
      type: 'file-selector',
      canonicalParamId: 'backupId',
      selectorKey: 'planetscale.backups',
      dependsOn: {
        all: ['serviceTokenId', 'serviceToken', 'organization', 'databaseSelector'],
        // Database enables the default-parent lookup; branch dependencies retain explicit context.
        any: ['databaseSelector', 'branchSelector', 'parentBranchSelector'],
      },
      placeholder: 'Select backup',
      mode: 'basic',
      required: { field: 'operation', value: ['get_backup'] },
      condition: { field: 'operation', value: ['create_branch', 'get_backup'] },
    },
    {
      id: 'manualBackupId',
      title: 'Backup ID',
      type: 'short-input',
      placeholder: 'Enter backup ID',
      canonicalParamId: 'backupId',
      mode: 'advanced',
      required: { field: 'operation', value: ['get_backup'] },
      condition: { field: 'operation', value: ['create_branch', 'get_backup'] },
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Defaults to the database region',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'restorePoint',
      title: 'Restore Point',
      type: 'short-input',
      placeholder: '2023-01-01T00:00:00Z',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the described date and time to an ISO 8601 UTC timestamp such as 2023-01-01T00:00:00Z. Preserve existing workflow or environment references unchanged. Return ONLY the timestamp or reference.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'replicas',
      title: 'Replicas',
      type: 'short-input',
      placeholder: '0 to 8',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'seedData',
      title: 'Seed Data',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Last Successful Backup', id: 'last_successful_backup' },
      ],
    },
    {
      id: 'clusterSize',
      title: 'Cluster Size',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      placeholder: 'Required for backup restores, e.g. PS_10',
    },
    {
      id: 'majorVersion',
      title: 'Major Version',
      type: 'short-input',
      placeholder: 'Defaults to the parent branch version',
      condition: { field: 'operation', value: ['create_branch'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'branchSelector',
      title: 'Branch',
      type: 'file-selector',
      canonicalParamId: 'branch',
      selectorKey: 'planetscale.branches',
      dependsOn: ['serviceTokenId', 'serviceToken', 'organization', 'databaseSelector'],
      placeholder: 'Select branch',
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'create_deploy_request',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'list_deploy_requests',
          'create_deploy_request',
        ],
      },
    },
    {
      id: 'manualBranch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'Enter branch name',
      canonicalParamId: 'branch',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'create_deploy_request',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_branch',
          'delete_branch',
          'list_backups',
          'create_backup',
          'get_backup',
          'list_deploy_requests',
          'create_deploy_request',
        ],
      },
    },
    {
      id: 'deleteDescendants',
      title: 'Delete Descendants',
      type: 'dropdown',
      condition: { field: 'operation', value: ['delete_branch'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'all',
      title: 'Include Deleted Backups',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_backups'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'backupState',
      title: 'Backup State',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_backups'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Pending', id: 'pending' },
        { label: 'Running', id: 'running' },
        { label: 'Success', id: 'success' },
        { label: 'Failed', id: 'failed' },
        { label: 'Canceled', id: 'canceled' },
        { label: 'Ignored', id: 'ignored' },
      ],
    },
    {
      id: 'policy',
      title: 'Policy',
      type: 'short-input',
      placeholder: 'Enter backup policy ID',
      condition: { field: 'operation', value: ['list_backups'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: '2023-01-01T00:00:00Z',
      condition: { field: 'operation', value: ['list_backups'] },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the described date and time to an ISO 8601 UTC timestamp such as 2023-01-01T00:00:00Z. Preserve existing workflow or environment references unchanged. Return ONLY the timestamp or reference.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: '2023-01-31T23:59:59Z',
      condition: { field: 'operation', value: ['list_backups'] },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the described date and time to an ISO 8601 UTC timestamp such as 2023-01-01T00:00:00Z. Preserve existing workflow or environment references unchanged. Return ONLY the timestamp or reference.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'runningAt',
      title: 'Running At',
      type: 'short-input',
      placeholder: '2023-01-01T00:00:00Z..2023-01-31T23:59:59Z',
      condition: { field: 'operation', value: ['list_backups', 'list_deploy_requests'] },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the described time interval to two ISO 8601 UTC timestamps separated by .., such as 2023-01-01T00:00:00Z..2023-01-31T23:59:59Z. Preserve existing workflow or environment references unchanged. Return ONLY the start..end interval or reference.',
        placeholder: 'Describe the time interval',
      },
    },
    {
      id: 'retentionUnit',
      title: 'Retention Unit',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_backup'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Hour', id: 'hour' },
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
      ],
    },
    {
      id: 'retentionValue',
      title: 'Retention Value',
      type: 'short-input',
      placeholder: '1 to 1000',
      condition: { field: 'operation', value: ['create_backup'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'emergency',
      title: 'Emergency',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_backup'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'deployRequestState',
      title: 'Deploy Request State',
      type: 'short-input',
      placeholder: 'open, closed, or deployed',
      condition: { field: 'operation', value: ['list_deploy_requests'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'intoBranchSelector',
      title: 'Target Branch',
      type: 'file-selector',
      canonicalParamId: 'intoBranch',
      selectorKey: 'planetscale.branches',
      dependsOn: ['serviceTokenId', 'serviceToken', 'organization', 'databaseSelector'],
      placeholder: 'Select target branch',
      mode: 'basic',
      required: { field: 'operation', value: ['create_deploy_request'] },
      condition: { field: 'operation', value: ['list_deploy_requests', 'create_deploy_request'] },
    },
    {
      id: 'manualIntoBranch',
      title: 'Target Branch Name',
      type: 'short-input',
      placeholder: 'Enter target branch name',
      canonicalParamId: 'intoBranch',
      mode: 'advanced',
      required: { field: 'operation', value: ['create_deploy_request'] },
      condition: { field: 'operation', value: ['list_deploy_requests', 'create_deploy_request'] },
    },
    {
      id: 'deployedAt',
      title: 'Deployed At',
      type: 'short-input',
      placeholder: '2023-01-01T00:00:00Z..2023-01-31T23:59:59Z',
      condition: { field: 'operation', value: ['list_deploy_requests'] },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the described time interval to two ISO 8601 UTC timestamps separated by .., such as 2023-01-01T00:00:00Z..2023-01-31T23:59:59Z. Preserve existing workflow or environment references unchanged. Return ONLY the start..end interval or reference.',
        placeholder: 'Describe the time interval',
      },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Describe the schema change',
      condition: { field: 'operation', value: ['create_deploy_request'] },
      required: false,
    },
    {
      id: 'autoCutover',
      title: 'Auto Cutover',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_deploy_request'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'autoDeleteBranch',
      title: 'Auto Delete Branch',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_deploy_request'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'deployRequestNumberSelector',
      title: 'Deploy Request',
      type: 'file-selector',
      canonicalParamId: 'deployRequestNumber',
      selectorKey: 'planetscale.deployRequests',
      dependsOn: ['serviceTokenId', 'serviceToken', 'organization', 'databaseSelector'],
      placeholder: 'Select deploy request',
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
    },
    {
      id: 'manualDeployRequestNumber',
      title: 'Deploy Request Number',
      type: 'short-input',
      placeholder: 'Enter deploy request number',
      canonicalParamId: 'deployRequestNumber',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_deploy_request',
          'close_deploy_request',
          'queue_deploy_request',
          'review_deploy_request',
        ],
      },
    },
    {
      id: 'instantDdl',
      title: 'Instant DDL',
      type: 'dropdown',
      condition: { field: 'operation', value: ['queue_deploy_request'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'reviewState',
      title: 'Review State',
      type: 'dropdown',
      condition: { field: 'operation', value: ['review_deploy_request'] },
      required: false,
      options: [
        { label: 'Default', id: '' },
        { label: 'Commented', id: 'commented' },
        { label: 'Approved', id: 'approved' },
      ],
      value: () => 'commented',
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Add review comments',
      condition: { field: 'operation', value: ['review_deploy_request'] },
      required: false,
    },
  ],
  inputs: {
    serviceTokenId: { type: 'string', description: 'Service token ID' },
    serviceToken: { type: 'string', description: 'Service token secret' },
    organization: { type: 'string', description: 'PlanetScale organization slug' },
    q: { type: 'string', description: 'Search databases or branches by name' },
    page: {
      type: 'number',
      description: 'If provided, specifies the page offset of returned results',
    },
    perPage: {
      type: 'number',
      description: 'If provided, specifies the number of returned results',
    },
    database: {
      type: 'string',
      description: 'PlanetScale database name',
    },
    production: { type: 'boolean', description: 'Filter branches or backups by production status' },
    safeMigrations: {
      type: 'boolean',
      description: 'Filter branches by safe migrations (DDL protection)',
    },
    order: { type: 'string', description: 'Order branches by created_at time' },
    name: { type: 'string', description: 'Name for the new branch or backup' },
    deletionProtected: {
      type: 'boolean',
      description: 'Whether deletion protection is enabled for the branch',
    },
    parentBranch: {
      type: 'string',
      description:
        "The name of the parent branch. Defaults to the database's default branch if not provided.",
    },
    backupId: { type: 'string', description: 'The ID for the backup' },
    region: {
      type: 'string',
      description:
        'The region to create the branch in. If not provided, the branch will be created in the default region for its database.',
    },
    restorePoint: {
      type: 'string',
      description:
        'Restore from a point-in-time recovery timestamp (e.g. 2023-01-01T00:00:00Z). Available only for PostgreSQL databases.',
    },
    replicas: {
      type: 'number',
      description:
        "For PostgreSQL backup restores and point-in-time recovery, the number of additional replicas from 0 to 8, subject to the target cluster size. 0 creates a single-node branch. If omitted, the target cluster size's minimum is used.",
    },
    seedData: {
      type: 'string',
      description:
        "If provided, restores the last successful backup's schema and data to the new branch. Must have `restore_production_branch_backup(s)` or `restore_backup(s)` access to do this, in addition to Data Branching\u2122 being enabled for the branch.",
    },
    clusterSize: {
      type: 'string',
      description:
        'The database cluster size. Required when backupId is provided, optional otherwise. Options: PS_10, PS_20, PS_40, ..., PS_2800',
    },
    majorVersion: {
      type: 'string',
      description:
        "For PostgreSQL and Neki databases, the PostgreSQL major version to use for the branch. Defaults to the major version of the parent branch if it exists or the database's default branch major version. Ignored for branches restored from backups.",
    },
    branch: {
      type: 'string',
      description: 'Branch name for the selected operation',
    },
    deleteDescendants: {
      type: 'boolean',
      description: 'If true, recursively delete all descendant branches along with this branch',
    },
    all: { type: 'boolean', description: 'Whether to include all backups, including deleted ones' },
    backupState: { type: 'string', description: 'Filter backups by state' },
    policy: { type: 'string', description: 'Filter backups by backup policy ID' },
    from: {
      type: 'string',
      description: 'Filter backups started after this date (e.g. 2023-01-01T00:00:00Z)',
    },
    to: {
      type: 'string',
      description: 'Filter backups started before this date (e.g. 2023-01-31T23:59:59Z)',
    },
    runningAt: {
      type: 'string',
      description:
        'Filter backups or deploy requests by when they were running. (e.g. 2023-01-01T00:00:00Z..2023-01-31T23:59:59Z)',
    },
    retentionUnit: { type: 'string', description: 'Unit for the retention period of the backup' },
    retentionValue: {
      type: 'number',
      description:
        'Value between `1` and `1000` for the retention period of the backup (i.e retention_value `6` and retention_unit `hour` means 6 hours)',
    },
    emergency: {
      type: 'boolean',
      description:
        'Whether the backup is an immediate backup that may affect database performance. Emergency backups are only supported for PostgreSQL databases.',
    },
    deployRequestState: {
      type: 'string',
      description: 'Filter by state of the deploy request (open, closed, deployed)',
    },
    intoBranch: {
      type: 'string',
      description: 'The name of the branch the deploy request will be merged into',
    },
    deployedAt: {
      type: 'string',
      description:
        'Filter deploy requests by the date they were deployed. (e.g. 2023-01-01T00:00:00Z..2023-01-31T23:59:59Z)',
    },
    notes: { type: 'string', description: 'Notes about the deploy request' },
    autoCutover: {
      type: 'boolean',
      description:
        'Whether or not to enable auto_cutover for the deploy request. When enabled, will auto cutover to the new schema as soon as it is ready.',
    },
    autoDeleteBranch: {
      type: 'boolean',
      description:
        'Whether or not to enable auto_delete_branch for the deploy request. When enabled, will delete the branch once the DR successfully completes.',
    },
    deployRequestNumber: { type: 'number', description: 'The number of the deploy request' },
    instantDdl: {
      type: 'boolean',
      description: 'Whether or not to deploy the request with instant DDL. Defaults to false.',
    },
    reviewState: {
      type: 'string',
      description:
        'Whether the review is a comment or approval. Service tokens must have corresponding access (either `approve_deploy_request` or `review_deploy_request`)',
    },
    body: { type: 'string', description: 'Deploy request review comments' },
  },
  tools: {
    access: [
      'planetscale_list_databases',
      'planetscale_get_database',
      'planetscale_list_branches',
      'planetscale_get_branch',
      'planetscale_create_branch',
      'planetscale_delete_branch',
      'planetscale_list_backups',
      'planetscale_get_backup',
      'planetscale_create_backup',
      'planetscale_list_deploy_requests',
      'planetscale_get_deploy_request',
      'planetscale_create_deploy_request',
      'planetscale_review_deploy_request',
      'planetscale_queue_deploy_request',
      'planetscale_close_deploy_request',
    ],
    config: {
      tool: (params) => `planetscale_${params.operation}`,
      params: (params) => ({
        ...params,
        page: optionalNumber(params.page),
        perPage: optionalNumber(params.perPage),
        production: optionalBoolean(params.production),
        safeMigrations: optionalBoolean(params.safeMigrations),
        deletionProtected: optionalBoolean(params.deletionProtected),
        replicas: optionalNumber(params.replicas),
        deleteDescendants: optionalBoolean(params.deleteDescendants),
        all: optionalBoolean(params.all),
        retentionValue: optionalNumber(params.retentionValue),
        emergency: optionalBoolean(params.emergency),
        autoCutover: optionalBoolean(params.autoCutover),
        autoDeleteBranch: optionalBoolean(params.autoDeleteBranch),
        deployRequestNumber: optionalNumber(params.deployRequestNumber),
        instantDdl: optionalBoolean(params.instantDdl),
        state:
          params.operation === 'list_backups'
            ? params.backupState
            : params.operation === 'list_deploy_requests'
              ? params.deployRequestState
              : params.reviewState,
      }),
    },
  },
  outputs: {
    databases: {
      type: 'array',
      description:
        'Databases (id, name, kind, state, ready, defaultBranch, branchesCount, deletionProtected, requireApprovalForDeploy, createdAt, updatedAt, htmlUrl)',
      condition: { field: 'operation', value: ['list_databases'] },
    },
    database: {
      type: 'json',
      description:
        'Database (id, name, kind, state, ready, defaultBranch, branchesCount, deletionProtected, requireApprovalForDeploy, createdAt, updatedAt, htmlUrl)',
      condition: { field: 'operation', value: ['get_database'] },
    },
    branches: {
      type: 'array',
      description:
        'Branches (id, name, kind, state, ready, production, safeMigrations, deletionProtected, parentBranch, createdAt, updatedAt, htmlUrl)',
      condition: { field: 'operation', value: ['list_branches'] },
    },
    branch: {
      type: 'json',
      description:
        'Branch (id, name, kind, state, ready, production, safeMigrations, deletionProtected, parentBranch, createdAt, updatedAt, htmlUrl)',
      condition: { field: 'operation', value: ['get_branch', 'create_branch'] },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the selected branch was deleted',
      condition: { field: 'operation', value: ['delete_branch'] },
    },
    backups: {
      type: 'array',
      description:
        'Backups (id, name, state, size, estimatedStorageCost, protected, createdAt, updatedAt, startedAt, completedAt, expiresAt)',
      condition: { field: 'operation', value: ['list_backups'] },
    },
    backup: {
      type: 'json',
      description:
        'Backup (id, name, state, size, estimatedStorageCost, protected, createdAt, updatedAt, startedAt, completedAt, expiresAt)',
      condition: { field: 'operation', value: ['get_backup', 'create_backup'] },
    },
    deployRequests: {
      type: 'array',
      description:
        'Vitess deploy requests (id, number, branch, intoBranch, state, deploymentState, approved, numComments, notes, createdAt, updatedAt, closedAt, deployedAt, htmlUrl)',
      condition: { field: 'operation', value: ['list_deploy_requests'] },
    },
    deployRequest: {
      type: 'json',
      description:
        'Vitess deploy request (id, number, branch, intoBranch, state, deploymentState, approved, numComments, notes, createdAt, updatedAt, closedAt, deployedAt, htmlUrl)',
      condition: {
        field: 'operation',
        value: [
          'get_deploy_request',
          'create_deploy_request',
          'queue_deploy_request',
          'close_deploy_request',
        ],
      },
    },
    review: {
      type: 'json',
      description: 'Deploy-request review (id, state, body, createdAt, updatedAt)',
      condition: { field: 'operation', value: ['review_deploy_request'] },
    },
    pagination: {
      type: 'json',
      description: 'Pagination (currentPage, perPage, nextPage, totalCount, totalPages)',
      condition: {
        field: 'operation',
        value: ['list_databases', 'list_branches', 'list_backups', 'list_deploy_requests'],
      },
    },
  },
}
export const PlanetScaleBlockMeta = {
  tags: ['cloud', 'ci-cd', 'automation'],
  url: 'https://planetscale.com',
  templates: [
    {
      icon: PlanetScaleIcon,
      title: 'Database inventory',
      prompt:
        'Build a workflow. On a daily schedule, list PlanetScale databases and summarize their readiness and branch counts.',
      modules: ['workflows', 'scheduled'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Feature branch setup',
      prompt:
        'Build a workflow. When a GitHub pull request opens, create a PlanetScale development branch from its configured parent and report the new branch state.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Pre-deployment backup',
      prompt:
        'Build a workflow. Before an approved release, create a backup of the selected PlanetScale branch and return its ID and current state.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Backup health report',
      prompt:
        'Build a workflow. On a daily schedule, list backups for a PlanetScale branch and summarize successful and failed backups.',
      modules: ['workflows', 'scheduled'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Restore rehearsal',
      prompt:
        'Build a workflow. On a scheduled restore drill, select a successful backup, create a separate branch from it, and report the branch readiness. Run subsequent checks with the appropriate SQL integration.',
      modules: ['workflows', 'scheduled'],
      category: 'engineering',
      tags: ['automation'],
      alsoIntegrations: ['mysql', 'postgresql'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Schema release request',
      prompt:
        'Build a workflow. When a release is ready for schema review, create a Vitess deploy request from the development branch into the target branch and return its number and URL.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Deployment status report',
      prompt:
        'Build a workflow. On a schedule, list Vitess deploy requests and report their deployment states to Slack.',
      modules: ['workflows', 'scheduled'],
      category: 'engineering',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PlanetScaleIcon,
      title: 'Review and queue deployment',
      prompt:
        'Build a workflow. After explicit release approval, approve a Vitess deploy request, queue it, and report its current deployment state.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'inspect-databases',
      description: 'Inventory PlanetScale databases and branches before planning maintenance.',
      content:
        '# Inspect Databases\n\n## Steps\nList databases in the organization. Get details for the selected database. List its branches and summarize readiness and safe-migration settings.\n\n## Output\nReturn resource identifiers and current states.\n\n## Reference\nhttps://planetscale.com/docs/api/reference/list_databases',
    },
    {
      name: 'prepare-schema-release',
      description: 'Create and review a Vitess deploy request for a prepared schema change.',
      content:
        '# Prepare Schema Release\n\n## Steps\nCreate a deploy request from the prepared source branch into the target branch. Get its state. Present the number and URL for approval. Only review or queue after explicit authorization.\n\n## Output\nReturn resource identifiers and current states.\n\n## Reference\nhttps://planetscale.com/docs/vitess/schema-changes/deploy-requests',
    },
    {
      name: 'check-backup-health',
      description: 'Inspect branch backups and report their completion state.',
      content:
        '# Check Backup Health\n\n## Steps\nList backups for the chosen branch. Get details for the selected backup. Report completion state, size, and expiration.\n\n## Output\nReturn resource identifiers and current states.\n\n## Reference\nhttps://planetscale.com/docs/vitess/backups',
    },
    {
      name: 'rehearse-backup-restore',
      description: 'Restore a successful backup into a separate branch for a recovery drill.',
      content:
        '# Rehearse Backup Restore\n\n## Steps\nList backups and choose a successful backup after confirming scope. Confirm a supported target cluster size, then create a new branch with the backup ID, parent branch, and cluster size. Get branch readiness. Do not delete the restored branch without authorization.\n\n## Output\nReturn resource identifiers and current states.\n\n## Reference\nhttps://planetscale.com/learn/courses/vitess/vitess-at-planetscale',
    },
    {
      name: 'track-schema-deployment',
      description: 'Report the current state of queued Vitess schema deployments.',
      content:
        '# Track Schema Deployment\n\n## Steps\nList deploy requests. Get the selected request. Report its current deployment state and URL. This skill does not wait for completion.\n\n## Output\nReturn resource identifiers and current states.\n\n## Reference\nhttps://planetscale.com/docs/vitess/schema-changes/deploy-requests',
    },
  ],
} as const satisfies BlockMeta
