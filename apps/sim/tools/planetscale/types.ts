import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface PlanetScaleCredentials {
  serviceTokenId: string
  serviceToken: string
}

export interface PlanetScaleScope extends PlanetScaleCredentials {
  organization: string
  database?: string
  branch?: string
}

export interface PlanetScaleDatabase {
  id: string
  name: string
  kind: string
  state: string
  ready: boolean
  defaultBranch: string
  branchesCount: number
  deletionProtected: boolean
  requireApprovalForDeploy: boolean
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export const PLANETSCALE_DATABASE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The ID of the database' },
  name: { type: 'string', description: 'Name of the database' },
  kind: { type: 'string', description: 'The kind of database' },
  state: { type: 'string', description: 'State of the database' },
  ready: { type: 'boolean', description: 'If the database is ready to be used' },
  defaultBranch: { type: 'string', description: 'The default branch for the database' },
  branchesCount: { type: 'number', description: 'The total number of database branches' },
  deletionProtected: {
    type: 'boolean',
    description: 'Whether deletion protection is enabled for the database',
  },
  requireApprovalForDeploy: {
    type: 'boolean',
    description: 'Whether an approval is required to deploy schema changes to this database',
  },
  createdAt: { type: 'string', description: 'When the database was created' },
  updatedAt: { type: 'string', description: 'When the database was last updated' },
  htmlUrl: { type: 'string', description: "The URL to see this database's branches in the web UI" },
} satisfies Record<string, OutputProperty>

export interface PlanetScaleBranch {
  id: string
  name: string
  kind: string
  state: string
  ready: boolean
  production: boolean
  safeMigrations: boolean
  deletionProtected: boolean
  parentBranch: string | null
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export const PLANETSCALE_BRANCH_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The ID of the branch' },
  name: { type: 'string', description: 'The name of the branch' },
  kind: { type: 'string', description: 'The kind of branch' },
  state: { type: 'string', description: 'The current state of the branch' },
  ready: { type: 'boolean', description: 'Whether or not the branch is ready to serve queries' },
  production: { type: 'boolean', description: 'Whether or not the branch is a production branch' },
  safeMigrations: {
    type: 'boolean',
    description: 'Whether or not the branch has safe migrations enabled',
  },
  deletionProtected: {
    type: 'boolean',
    description: 'Whether deletion protection is enabled for the branch',
  },
  parentBranch: {
    type: 'string',
    description: 'The name of the parent branch from which the branch was created',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'When the branch was created' },
  updatedAt: { type: 'string', description: 'When the branch was last updated' },
  htmlUrl: { type: 'string', description: 'Planetscale app URL for the branch' },
} satisfies Record<string, OutputProperty>

export interface PlanetScaleBackup {
  id: string
  name: string
  state: string
  size: number
  estimatedStorageCost: number
  protected: boolean
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
}

export const PLANETSCALE_BACKUP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The ID of the backup' },
  name: { type: 'string', description: 'The name of the backup' },
  state: { type: 'string', description: 'The current state of the backup' },
  size: { type: 'number', description: 'The size of the backup in bytes' },
  estimatedStorageCost: { type: 'number', description: 'The estimated storage cost of the backup' },
  protected: {
    type: 'boolean',
    description: 'Whether or not the backup is protected from deletion',
  },
  createdAt: { type: 'string', description: 'When the backup was created' },
  updatedAt: { type: 'string', description: 'When the backup was last updated' },
  startedAt: { type: 'string', description: 'When the backup started', nullable: true },
  completedAt: { type: 'string', description: 'When the backup completed', nullable: true },
  expiresAt: { type: 'string', description: 'When the backup expires', nullable: true },
} satisfies Record<string, OutputProperty>

export interface PlanetScaleDeployRequest {
  id: string
  number: number
  branch: string
  intoBranch: string
  state: string
  deploymentState: string
  approved: boolean
  numComments: number
  notes: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  deployedAt: string | null
  htmlUrl: string
}

export const PLANETSCALE_DEPLOYREQUEST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The ID of the deploy request' },
  number: { type: 'number', description: 'The number of the deploy request' },
  branch: {
    type: 'string',
    description: 'The name of the branch the deploy request was created from',
  },
  intoBranch: {
    type: 'string',
    description: 'The name of the branch the deploy request will be merged into',
  },
  state: { type: 'string', description: 'Whether the deploy request is open or closed' },
  deploymentState: { type: 'string', description: 'The deployment state of the deploy request' },
  approved: { type: 'boolean', description: 'Whether or not the deploy request is approved' },
  numComments: { type: 'number', description: 'The number of comments on the deploy request' },
  notes: { type: 'string', description: 'Notes on the deploy request' },
  createdAt: { type: 'string', description: 'When the deploy request was created' },
  updatedAt: { type: 'string', description: 'When the deploy request was last updated' },
  closedAt: { type: 'string', description: 'When the deploy request was closed', nullable: true },
  deployedAt: {
    type: 'string',
    description: 'When the deploy request was deployed',
    nullable: true,
  },
  htmlUrl: { type: 'string', description: 'The PlanetScale app address for the deploy request' },
} satisfies Record<string, OutputProperty>

export interface PlanetScaleReview {
  id: string
  state: string
  body: string
  createdAt: string
  updatedAt: string
}

export const PLANETSCALE_REVIEW_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The ID of the review' },
  state: { type: 'string', description: 'Whether the review is a comment or approval' },
  body: { type: 'string', description: 'The text body of the review' },
  createdAt: { type: 'string', description: 'When the review was created' },
  updatedAt: { type: 'string', description: 'When the review was last updated' },
} satisfies Record<string, OutputProperty>

export interface PlanetScalePagination {
  currentPage: number
  perPage: number
  nextPage: number | null
  totalCount: number
  totalPages: number
}

export const PLANETSCALE_PAGINATION_OUTPUT = {
  type: 'json',
  description: 'Pagination metadata',
  properties: {
    currentPage: { type: 'number', description: 'current page' },
    perPage: { type: 'number', description: 'per page' },
    nextPage: { type: 'number', description: 'next page', nullable: true },
    totalCount: { type: 'number', description: 'total count' },
    totalPages: { type: 'number', description: 'total pages' },
  },
} satisfies OutputProperty

export interface PlanetScaleListDatabasesParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  q?: string
  page?: number
  perPage?: number
}

export interface PlanetScaleGetDatabaseParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
}

export interface PlanetScaleListBranchesParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  q?: string
  production?: boolean
  safeMigrations?: boolean
  order?: string
  page?: number
  perPage?: number
}

export interface PlanetScaleGetBranchParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  branch: string
}

export interface PlanetScaleCreateBranchParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  name: string
  deletionProtected?: boolean
  parentBranch?: string
  backupId?: string
  region?: string
  restorePoint?: string
  replicas?: number
  seedData?: string
  clusterSize?: string
  majorVersion?: string
}

export interface PlanetScaleDeleteBranchParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  branch: string
  deleteDescendants?: boolean
}

export interface PlanetScaleListBackupsParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  branch: string
  all?: boolean
  state?: string
  policy?: string
  from?: string
  to?: string
  runningAt?: string
  production?: boolean
  page?: number
  perPage?: number
}

export interface PlanetScaleGetBackupParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  backupId: string
  database: string
  branch: string
}

export interface PlanetScaleCreateBackupParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  branch: string
  name?: string
  retentionUnit?: string
  retentionValue?: number
  emergency?: boolean
}

export interface PlanetScaleListDeployRequestsParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  state?: string
  branch?: string
  intoBranch?: string
  deployedAt?: string
  runningAt?: string
  page?: number
  perPage?: number
}

export interface PlanetScaleGetDeployRequestParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  deployRequestNumber: number
}

export interface PlanetScaleCreateDeployRequestParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  branch: string
  intoBranch: string
  notes?: string
  autoCutover?: boolean
  autoDeleteBranch?: boolean
}

export interface PlanetScaleReviewDeployRequestParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  deployRequestNumber: number
  state?: string
  body?: string
}

export interface PlanetScaleQueueDeployRequestParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  deployRequestNumber: number
  instantDdl?: boolean
}

export interface PlanetScaleCloseDeployRequestParams {
  serviceTokenId: string
  serviceToken: string
  organization: string
  database: string
  deployRequestNumber: number
}

export interface PlanetScaleToolResponse<T extends Record<string, unknown>> extends ToolResponse {
  output: T
}
