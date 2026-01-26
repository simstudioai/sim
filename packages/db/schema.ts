import { type SQL, sql } from 'drizzle-orm'
import {
  bigint,
  check,
  customType,
  decimal,
  doublePrecision,
  index,
  integer,
  json,
  jsonb,
  boolean as pgBoolean,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  vector,
} from 'drizzle-orm/pg-core'
import { DEFAULT_FREE_CREDITS, TAG_SLOTS } from './constants'

const IS_IRIS = process.env.DB_TYPE === 'iris'

/**
 * Helper for indexable text columns (PKs, FKs, Unique)
 * IRIS: varchar(255)
 * Postgres: text
 */
const indexableText = (name: string, options?: any) =>
  IS_IRIS ? varchar(name, { length: 255, ...options }) : text(name, options)

/**
 * Helper for longer indexable text columns (Tokens, Paths)
 * IRIS: varchar(1024)
 * Postgres: text
 */
const indexableTextLong = (name: string, options?: any) =>
  IS_IRIS ? varchar(name, { length: 1024, ...options }) : text(name, options)

/**
 * Helper for timestamp default now
 * For IRIS: Use $defaultFn to compute at insert time (Drizzle-side)
 * For Postgres: Use database-side default
 */
const defaultNow = () => (IS_IRIS ? sql`CURRENT_TIMESTAMP` : sql`now()`)

/**
 * Helper to apply timestamp default - uses $defaultFn for IRIS, .default() for Postgres
 * This ensures Drizzle computes the timestamp value for IRIS instead of relying on DB defaults
 */
const timestampWithDefault = (name: string) => {
  const col = timestamp(name).notNull()
  return IS_IRIS ? col.$defaultFn(() => new Date()) : col.default(sql`now()`)
}

const timestampWithDefaultNullable = (name: string) => {
  const col = timestamp(name)
  return IS_IRIS ? col.$defaultFn(() => new Date()) : col.default(sql`now()`)
}

/**
 * Custom type for JSON columns with proper serialization for IRIS
 * IRIS: text (with JSON string serialization)
 * Postgres: json (native JSON)
 */
const irisJsonType = customType<{
  data: any
  driverData: string
}>({
  dataType() {
    return 'text'
  },
  toDriver(value: any): string {
    return JSON.stringify(value)
  },
  fromDriver(value: string): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    return value
  },
})

const irisJsonbType = customType<{
  data: any
  driverData: string
}>({
  dataType() {
    return 'text'
  },
  toDriver(value: any): string {
    return JSON.stringify(value)
  },
  fromDriver(value: string): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    return value
  },
})

/**
 * Custom type for boolean columns with proper serialization for IRIS
 * IRIS: smallint (with 0/1 serialization)
 * Postgres: boolean (native boolean)
 */
const irisBooleanType = customType<{
  data: boolean
  driverData: number
}>({
  dataType() {
    return 'smallint'
  },
  toDriver(value: boolean): number {
    return value ? 1 : 0
  },
  fromDriver(value: number): boolean {
    return value === 1
  },
})

/**
 * Helper for JSON/JSONB columns
 * IRIS: text with JSON serialization
 * Postgres: json/jsonb
 */
const jsonText = (name: string) => (IS_IRIS ? irisJsonType(name) : json(name))
const jsonbText = (name: string) => (IS_IRIS ? irisJsonbType(name) : jsonb(name))

/**
 * Helper for boolean columns
 * IRIS: smallint with 0/1 serialization
 * Postgres: boolean
 */
const booleanType = (name: string) => (IS_IRIS ? irisBooleanType(name) : pgBoolean(name))

/**
 * Helper for boolean default values
 * IRIS: 1/0
 * Postgres: true/false
 */
const booleanDefault = (value: boolean) => (IS_IRIS ? (value ? 1 : 0) : value) as any

/**
 * Helper for boolean columns with defaults - uses $defaultFn for IRIS
 * This ensures Drizzle computes the value for IRIS instead of relying on DB defaults
 */
const booleanWithDefault = (name: string, defaultValue: boolean) => {
  const col = booleanType(name).notNull()
  return IS_IRIS ? col.$defaultFn(() => defaultValue) : col.default(defaultValue)
}

/**
 * Helper for non-large text columns
 * IRIS: varchar(255)
 * Postgres: text
 */
const shortText = (name: string, options?: any) =>
  IS_IRIS ? varchar(name, { length: 255, ...options }) : text(name, options)

/**
 * Helper for array columns
 * IRIS: text (storing as string)
 * Postgres: text[]
 */
const textArray = (name: string) => (IS_IRIS ? text(name) : text(name).array())
const arrayDefault = (value: any) => (IS_IRIS ? undefined : value)

/**
 * Helper for enum columns
 * IRIS: varchar(255)
 * Postgres: enum
 */
const enumColumn = (name: string, enumFn: any) =>
  IS_IRIS ? varchar(name, { length: 255 }) : enumFn(name)

/**
 * Helper for JSON default values
 * IRIS: undefined (avoid compilation errors with complex defaults)
 * Postgres: string
 */
const jsonDefault = (value: string) => (IS_IRIS ? undefined : value) as any

// Custom tsvector type for full-text search
export const tsvector = customType<{
  data: string
}>({
  dataType() {
    return `tsvector`
  },
})

export const user = pgTable('user', {
  id: indexableText('id').primaryKey(),
  name: shortText('name').notNull(),
  email: indexableText('email').notNull().unique(),
  emailVerified: booleanType('email_verified').notNull(),
  image: text('image'),
  createdAt: timestampWithDefault('created_at'),
  updatedAt: timestampWithDefault('updated_at'),
  stripeCustomerId: indexableText('stripe_customer_id'),
  isSuperUser: booleanType('is_super_user').notNull().default(booleanDefault(false)),
})

export const session = pgTable(
  'session',
  {
    id: indexableText('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: indexableTextLong('token').notNull().unique(),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
    ipAddress: indexableText('ip_address'),
    userAgent: text('user_agent'),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: indexableText('active_organization_id').references(
      () => organization.id,
      {
        onDelete: 'set null',
      }
    ),
  },
  (table) => ({
    userIdIdx: index('session_user_id_idx').on(table.userId),
    tokenIdx: index('session_token_idx').on(table.token),
  })
)

export const account = pgTable(
  'account',
  {
    id: indexableText('id').primaryKey(),
    accountId: indexableText('account_id').notNull(),
    providerId: indexableText('provider_id').notNull(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    userIdIdx: index('account_user_id_idx').on(table.userId),
    accountProviderIdx: index('idx_account_on_account_id_provider_id').on(
      table.accountId,
      table.providerId
    ),
    uniqueUserProviderAccount: uniqueIndex('account_user_provider_account_unique').on(
      table.userId,
      table.providerId,
      table.accountId
    ),
  })
)

export const verification = pgTable(
  'verification',
  {
    id: indexableText('id').primaryKey(),
    identifier: indexableText('identifier').notNull(),
    value: indexableText('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestampWithDefaultNullable('created_at'),
    updatedAt: timestampWithDefaultNullable('updated_at'),
  },
  (table) => ({
    identifierIdx: index('verification_identifier_idx').on(table.identifier),
    expiresAtIdx: index('verification_expires_at_idx').on(table.expiresAt),
  })
)

export const workflowFolder = pgTable(
  'workflow_folder',
  {
    id: indexableText('id').primaryKey(),
    name: shortText('name').notNull(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    parentId: indexableText('parent_id'), // Self-reference will be handled by foreign key constraint
    color: shortText('color').default('#6B7280'),
    isExpanded: booleanType('is_expanded').notNull().default(booleanDefault(true)),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    userIdx: index('workflow_folder_user_idx').on(table.userId),
    workspaceParentIdx: index('workflow_folder_workspace_parent_idx').on(
      table.workspaceId,
      table.parentId
    ),
    parentSortIdx: index('workflow_folder_parent_sort_idx').on(table.parentId, table.sortOrder),
  })
)

export const workflow = pgTable(
  'workflow',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: indexableText('workspace_id').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    folderId: indexableText('folder_id').references(() => workflowFolder.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#3972F6'),
    lastSynced: timestampWithDefault('last_synced'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
    isDeployed: booleanType('is_deployed').notNull().default(booleanDefault(false)),
    deployedAt: timestamp('deployed_at'),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at'),
    variables: jsonText('variables').default(jsonDefault('{}')),
  },
  (table) => ({
    userIdIdx: index('workflow_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workflow_workspace_id_idx').on(table.workspaceId),
    userWorkspaceIdx: index('workflow_user_workspace_idx').on(table.userId, table.workspaceId),
  })
)

export const workflowBlocks = pgTable(
  'workflow_blocks',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    type: indexableText('type').notNull(), // 'starter', 'agent', 'api', 'function'
    name: text('name').notNull(),

    positionX: decimal('position_x').notNull(),
    positionY: decimal('position_y').notNull(),

    enabled: booleanWithDefault('enabled', true),
    horizontalHandles: booleanWithDefault('horizontal_handles', true),
    isWide: booleanWithDefault('is_wide', false),
    advancedMode: booleanWithDefault('advanced_mode', false),
    triggerMode: booleanWithDefault('trigger_mode', false),
    height: decimal('height').notNull().default('0'),

    subBlocks: jsonbText('sub_blocks').notNull().default(jsonDefault('{}')),
    outputs: jsonbText('outputs').notNull().default(jsonDefault('{}')),
    data: jsonbText('data').default(jsonDefault('{}')),

    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_blocks_workflow_id_idx').on(table.workflowId),
    typeIdx: index('workflow_blocks_type_idx').on(table.type),
  })
)

export const workflowEdges = pgTable(
  'workflow_edges',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    sourceBlockId: indexableText('source_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    targetBlockId: indexableText('target_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    sourceHandle: indexableText('source_handle'),
    targetHandle: indexableText('target_handle'),

    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_edges_workflow_id_idx').on(table.workflowId),
    workflowSourceIdx: index('workflow_edges_workflow_source_idx').on(
      table.workflowId,
      table.sourceBlockId
    ),
    workflowTargetIdx: index('workflow_edges_workflow_target_idx').on(
      table.workflowId,
      table.targetBlockId
    ),
  })
)

export const workflowSubflows = pgTable(
  'workflow_subflows',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    type: indexableText('type').notNull(), // 'loop' or 'parallel'
    config: jsonbText('config').notNull().default(jsonDefault('{}')),

    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_subflows_workflow_id_idx').on(table.workflowId),
    workflowTypeIdx: index('workflow_subflows_workflow_type_idx').on(table.workflowId, table.type),
  })
)

export const waitlist = pgTable('waitlist', {
  id: indexableText('id').primaryKey(),
  email: indexableText('email').notNull().unique(),
  status: indexableText('status').notNull().default('pending'), // pending, approved, rejected
  createdAt: timestampWithDefault('created_at'),
  updatedAt: timestampWithDefault('updated_at'),
})

export const workflowExecutionSnapshots = pgTable(
  'workflow_execution_snapshots',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    stateHash: indexableText('state_hash').notNull(),
    stateData: jsonbText('state_data').notNull(),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_snapshots_workflow_id_idx').on(table.workflowId),
    stateHashIdx: index('workflow_snapshots_hash_idx').on(table.stateHash),
    workflowHashUnique: uniqueIndex('workflow_snapshots_workflow_hash_idx').on(
      table.workflowId,
      table.stateHash
    ),
    createdAtIdx: index('workflow_snapshots_created_at_idx').on(table.createdAt),
  })
)

export const workflowExecutionLogs = pgTable(
  'workflow_execution_logs',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    executionId: indexableText('execution_id').notNull(),
    stateSnapshotId: indexableText('state_snapshot_id')
      .notNull()
      .references(() => workflowExecutionSnapshots.id),
    deploymentVersionId: indexableText('deployment_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'set null' }
    ),

    level: indexableText('level').notNull(), // 'info' | 'error'
    status: indexableText('status').notNull().default('running'), // 'running' | 'pending' | 'completed' | 'failed' | 'cancelled'
    trigger: indexableText('trigger').notNull(), // 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'

    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    totalDurationMs: integer('total_duration_ms'),

    executionData: jsonbText('execution_data').notNull().default(jsonDefault('{}')),
    cost: jsonbText('cost'),
    files: jsonbText('files'), // File metadata for execution files
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_execution_logs_workflow_id_idx').on(table.workflowId),
    stateSnapshotIdIdx: index('workflow_execution_logs_state_snapshot_id_idx').on(
      table.stateSnapshotId
    ),
    deploymentVersionIdIdx: index('workflow_execution_logs_deployment_version_id_idx').on(
      table.deploymentVersionId
    ),
    triggerIdx: index('workflow_execution_logs_trigger_idx').on(table.trigger),
    levelIdx: index('workflow_execution_logs_level_idx').on(table.level),
    startedAtIdx: index('workflow_execution_logs_started_at_idx').on(table.startedAt),
    executionIdUnique: uniqueIndex('workflow_execution_logs_execution_id_unique').on(
      table.executionId
    ),
    workflowStartedAtIdx: index('workflow_execution_logs_workflow_started_at_idx').on(
      table.workflowId,
      table.startedAt
    ),
    workspaceStartedAtIdx: index('workflow_execution_logs_workspace_started_at_idx').on(
      table.workspaceId,
      table.startedAt
    ),
  })
)

export const pausedExecutions = pgTable(
  'paused_executions',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    executionId: indexableText('execution_id').notNull(),
    executionSnapshot: jsonbText('execution_snapshot').notNull(),
    pausePoints: jsonbText('pause_points').notNull(),
    totalPauseCount: integer('total_pause_count').notNull(),
    resumedCount: integer('resumed_count').notNull().default(0),
    status: indexableText('status').notNull().default('paused'),
    metadata: jsonbText('metadata')
      .notNull()
      .default(IS_IRIS ? sql`'{}'` : sql`'{}'::jsonb`),
    pausedAt: timestampWithDefault('paused_at'),
    updatedAt: timestampWithDefault('updated_at'),
    expiresAt: timestamp('expires_at'),
  },
  (table) => ({
    workflowIdx: index('paused_executions_workflow_id_idx').on(table.workflowId),
    statusIdx: index('paused_executions_status_idx').on(table.status),
    executionUnique: uniqueIndex('paused_executions_execution_id_unique').on(table.executionId),
  })
)

export const resumeQueue = pgTable(
  'resume_queue',
  {
    id: indexableText('id').primaryKey(),
    pausedExecutionId: indexableText('paused_execution_id')
      .notNull()
      .references(() => pausedExecutions.id, { onDelete: 'cascade' }),
    parentExecutionId: indexableText('parent_execution_id').notNull(),
    newExecutionId: indexableText('new_execution_id').notNull(),
    contextId: indexableText('context_id').notNull(),
    resumeInput: jsonbText('resume_input'),
    status: indexableText('status').notNull().default('pending'),
    queuedAt: timestampWithDefault('queued_at'),
    claimedAt: timestamp('claimed_at'),
    completedAt: timestamp('completed_at'),
    failureReason: text('failure_reason'),
  },
  (table) => ({
    parentStatusIdx: index('resume_queue_parent_status_idx').on(
      table.parentExecutionId,
      table.status,
      table.queuedAt
    ),
    newExecutionIdx: index('resume_queue_new_execution_idx').on(table.newExecutionId),
  })
)

export const environment = pgTable('environment', {
  id: indexableText('id').primaryKey(), // Use the user id as the key
  userId: indexableText('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One environment per user
  variables: jsonText('variables').notNull(),
  updatedAt: timestampWithDefault('updated_at'),
})

export const workspaceEnvironment = pgTable(
  'workspace_environment',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    variables: jsonText('variables').notNull().default(jsonDefault('{}')),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceUnique: uniqueIndex('workspace_environment_workspace_unique').on(table.workspaceId),
  })
)

export const workspaceBYOKKeys = pgTable(
  'workspace_byok_keys',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerId: indexableText('provider_id').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    createdBy: indexableText('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceProviderUnique: uniqueIndex('workspace_byok_provider_unique').on(
      table.workspaceId,
      table.providerId
    ),
    workspaceIdx: index('workspace_byok_workspace_idx').on(table.workspaceId),
  })
)

export const settings = pgTable('settings', {
  id: indexableText('id').primaryKey(), // Use the user id as the key
  userId: indexableText('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One settings record per user

  // General settings
  theme: indexableText('theme').notNull().default('system'),
  autoConnect: booleanType('auto_connect').notNull().default(booleanDefault(true)),

  // Privacy settings
  telemetryEnabled: booleanType('telemetry_enabled').notNull().default(booleanDefault(true)),

  // Email preferences
  emailPreferences: jsonText('email_preferences').notNull().default(jsonDefault('{}')),

  // Billing usage notifications preference
  billingUsageNotificationsEnabled: booleanType('billing_usage_notifications_enabled')
    .notNull()
    .default(booleanDefault(true)),

  // UI preferences
  showTrainingControls: booleanType('show_training_controls')
    .notNull()
    .default(booleanDefault(false)),
  superUserModeEnabled: booleanType('super_user_mode_enabled')
    .notNull()
    .default(booleanDefault(true)),

  // Notification preferences
  errorNotificationsEnabled: booleanType('error_notifications_enabled')
    .notNull()
    .default(booleanDefault(true)),

  // Canvas preferences
  snapToGridSize: integer('snap_to_grid_size').notNull().default(0), // 0 = off, 10-50 = grid size

  // Copilot preferences - maps model_id to enabled/disabled boolean
  copilotEnabledModels: jsonbText('copilot_enabled_models').notNull().default(jsonDefault('{}')),

  // Copilot auto-allowed integration tools - array of tool IDs that can run without confirmation
  copilotAutoAllowedTools: jsonbText('copilot_auto_allowed_tools')
    .notNull()
    .default(jsonDefault('[]')),

  updatedAt: timestampWithDefault('updated_at'),
})

export const workflowSchedule = pgTable(
  'workflow_schedule',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    blockId: indexableText('block_id').references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    cronExpression: indexableText('cron_expression'),
    nextRunAt: timestamp('next_run_at'),
    lastRanAt: timestamp('last_ran_at'),
    lastQueuedAt: timestamp('last_queued_at'),
    triggerType: indexableText('trigger_type').notNull(), // "manual", "webhook", "schedule"
    timezone: indexableText('timezone').notNull().default('UTC'),
    failedCount: integer('failed_count').notNull().default(0), // Track consecutive failures
    status: indexableText('status').notNull().default('active'), // 'active' or 'disabled'
    lastFailedAt: timestamp('last_failed_at'), // When the schedule last failed
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => {
    return {
      workflowBlockUnique: uniqueIndex('workflow_schedule_workflow_block_unique').on(
        table.workflowId,
        table.blockId
      ),
    }
  }
)

export const webhook = pgTable(
  'webhook',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    blockId: indexableText('block_id').references(() => workflowBlocks.id, { onDelete: 'cascade' }), // ID of the webhook trigger block (nullable for legacy starter block webhooks)
    path: indexableTextLong('path').notNull(),
    provider: indexableText('provider'), // e.g., "whatsapp", "github", etc.
    providerConfig: jsonText('provider_config'), // Store provider-specific configuration
    isActive: booleanType('is_active').notNull().default(booleanDefault(true)),
    failedCount: integer('failed_count').default(0), // Track consecutive failures
    lastFailedAt: timestamp('last_failed_at'), // When the webhook last failed
    credentialSetId: indexableText('credential_set_id').references(() => credentialSet.id, {
      onDelete: 'set null',
    }), // For credential set webhooks - enables efficient queries
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => {
    return {
      // Ensure webhook paths are unique
      pathIdx: uniqueIndex('path_idx').on(table.path),
      // Optimize queries for webhooks by workflow and block
      workflowBlockIdx: index('idx_webhook_on_workflow_id_block_id').on(
        table.workflowId,
        table.blockId
      ),
      // Optimize queries for credential set webhooks
      credentialSetIdIdx: index('webhook_credential_set_id_idx').on(table.credentialSetId),
    }
  }
)

export const notificationTypeEnum = pgEnum('notification_type', ['webhook', 'email', 'slack'])

export const notificationDeliveryStatusEnum = pgEnum('notification_delivery_status', [
  'pending',
  'in_progress',
  'success',
  'failed',
])

export const workspaceNotificationSubscription = pgTable(
  'workspace_notification_subscription',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    notificationType: enumColumn('notification_type', notificationTypeEnum).notNull(),
    workflowIds: textArray('workflow_ids').notNull().default(arrayDefault(sql`'{}'::text[]`)),
    allWorkflows: booleanType('all_workflows').notNull().default(booleanDefault(false)),
    levelFilter: textArray('level_filter')
      .notNull()
      .default(arrayDefault(sql`ARRAY['info', 'error']::text[]`)),
    triggerFilter: textArray('trigger_filter')
      .notNull()
      .default(arrayDefault(sql`ARRAY['api', 'webhook', 'schedule', 'manual', 'chat']::text[]`)),
    includeFinalOutput: booleanType('include_final_output')
      .notNull()
      .default(booleanDefault(false)),
    includeTraceSpans: booleanType('include_trace_spans').notNull().default(booleanDefault(false)),
    includeRateLimits: booleanType('include_rate_limits').notNull().default(booleanDefault(false)),
    includeUsageData: booleanType('include_usage_data').notNull().default(booleanDefault(false)),

    // Channel-specific configuration
    webhookConfig: jsonbText('webhook_config'),
    emailRecipients: textArray('email_recipients'),
    slackConfig: jsonbText('slack_config'),

    // Alert rule configuration (if null, sends on every execution)
    alertConfig: jsonbText('alert_config'),
    lastAlertAt: timestamp('last_alert_at'),

    active: booleanType('active').notNull().default(booleanDefault(true)),
    createdBy: indexableText('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('workspace_notification_workspace_id_idx').on(table.workspaceId),
    activeIdx: index('workspace_notification_active_idx').on(table.active),
    typeIdx: index('workspace_notification_type_idx').on(table.notificationType),
  })
)

export const workspaceNotificationDelivery = pgTable(
  'workspace_notification_delivery',
  {
    id: indexableText('id').primaryKey(),
    subscriptionId: indexableText('subscription_id')
      .notNull()
      .references(() => workspaceNotificationSubscription.id, { onDelete: 'cascade' }),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    executionId: indexableText('execution_id').notNull(),
    status: enumColumn('status', notificationDeliveryStatusEnum).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextAttemptAt: timestamp('next_attempt_at'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    subscriptionIdIdx: index('workspace_notification_delivery_subscription_id_idx').on(
      table.subscriptionId
    ),
    executionIdIdx: index('workspace_notification_delivery_execution_id_idx').on(table.executionId),
    statusIdx: index('workspace_notification_delivery_status_idx').on(table.status),
    nextAttemptIdx: index('workspace_notification_delivery_next_attempt_idx').on(
      table.nextAttemptAt
    ),
  })
)

export const apiKey = pgTable(
  'api_key',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: indexableText('workspace_id').references(() => workspace.id, {
      onDelete: 'cascade',
    }), // Only set for workspace keys
    createdBy: indexableText('created_by').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    key: indexableTextLong('key').notNull().unique(),
    type: indexableText('type').notNull().default('personal'),
    lastUsed: timestamp('last_used'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
    expiresAt: timestamp('expires_at'),
  },
  (table) => ({
    workspaceTypeIdx: index('api_key_workspace_type_idx').on(table.workspaceId, table.type),
    userTypeIdx: index('api_key_user_type_idx').on(table.userId, table.type),
    ...(IS_IRIS
      ? {}
      : {
          workspaceTypeCheck: check(
            'workspace_type_check',
            sql`(type = 'workspace' AND workspace_id IS NOT NULL) OR (type = 'personal' AND workspace_id IS NULL)`
          ),
        }),
  })
)

export const billingBlockedReasonEnum = pgEnum('billing_blocked_reason', [
  'payment_failed',
  'dispute',
])

export const userStats = pgTable('user_stats', {
  id: indexableText('id').primaryKey(),
  userId: indexableText('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One record per user
  totalManualExecutions: integer('total_manual_executions').notNull().default(0),
  totalApiCalls: integer('total_api_calls').notNull().default(0),
  totalWebhookTriggers: integer('total_webhook_triggers').notNull().default(0),
  totalScheduledExecutions: integer('total_scheduled_executions').notNull().default(0),
  totalChatExecutions: integer('total_chat_executions').notNull().default(0),
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  totalCost: decimal('total_cost').notNull().default('0'),
  currentUsageLimit: decimal('current_usage_limit').default(DEFAULT_FREE_CREDITS.toString()), // Default $20 for free plan, null for team/enterprise
  usageLimitUpdatedAt: timestampWithDefaultNullable('usage_limit_updated_at'),
  // Billing period tracking
  currentPeriodCost: decimal('current_period_cost').notNull().default('0'), // Usage in current billing period
  lastPeriodCost: decimal('last_period_cost').default('0'), // Usage from previous billing period
  billedOverageThisPeriod: decimal('billed_overage_this_period').notNull().default('0'), // Amount of overage already billed via threshold billing
  // Pro usage snapshot when joining a team (to prevent double-billing)
  proPeriodCostSnapshot: decimal('pro_period_cost_snapshot').default('0'), // Snapshot of Pro usage when joining team
  // Pre-purchased credits (for Pro users only)
  creditBalance: decimal('credit_balance').notNull().default('0'),
  // Copilot usage tracking
  totalCopilotCost: decimal('total_copilot_cost').notNull().default('0'),
  currentPeriodCopilotCost: decimal('current_period_copilot_cost').notNull().default('0'),
  lastPeriodCopilotCost: decimal('last_period_copilot_cost').default('0'),
  totalCopilotTokens: integer('total_copilot_tokens').notNull().default(0),
  totalCopilotCalls: integer('total_copilot_calls').notNull().default(0),
  // Storage tracking (for free/pro users)
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  lastActive: timestampWithDefault('last_active'),
  billingBlocked: booleanType('billing_blocked').notNull().default(booleanDefault(false)),
  billingBlockedReason: enumColumn('billing_blocked_reason', billingBlockedReasonEnum),
})

export const customTools = pgTable(
  'custom_tools',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    userId: indexableText('user_id').references(() => user.id, { onDelete: 'set null' }),
    title: indexableText('title').notNull(),
    schema: jsonText('schema').notNull(),
    code: text('code').notNull(),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('custom_tools_workspace_id_idx').on(table.workspaceId),
    workspaceTitleUnique: uniqueIndex('custom_tools_workspace_title_unique').on(
      table.workspaceId,
      table.title
    ),
  })
)

export const subscription = pgTable(
  'subscription',
  {
    id: indexableText('id').primaryKey(),
    plan: indexableText('plan').notNull(),
    referenceId: indexableText('reference_id').notNull(),
    stripeCustomerId: indexableText('stripe_customer_id'),
    stripeSubscriptionId: indexableText('stripe_subscription_id'),
    status: indexableText('status'),
    periodStart: timestamp('period_start'),
    periodEnd: timestamp('period_end'),
    cancelAtPeriodEnd: booleanType('cancel_at_period_end'),
    seats: integer('seats'),
    trialStart: timestamp('trial_start'),
    trialEnd: timestamp('trial_end'),
    metadata: jsonText('metadata'),
  },
  (table) => ({
    referenceStatusIdx: index('subscription_reference_status_idx').on(
      table.referenceId,
      table.status
    ),
    ...(IS_IRIS
      ? {}
      : {
          enterpriseMetadataCheck: check(
            'check_enterprise_metadata',
            sql`plan != 'enterprise' OR metadata IS NOT NULL`
          ),
        }),
  })
)

export const rateLimitBucket = pgTable('rate_limit_bucket', {
  key: indexableTextLong('key').primaryKey(),
  tokens: decimal('tokens').notNull(),
  lastRefillAt: timestamp('last_refill_at').notNull(),
  updatedAt: timestampWithDefault('updated_at'),
})

export const chat = pgTable(
  'chat',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    identifier: indexableText('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isActive: booleanType('is_active').notNull().default(booleanDefault(true)),
    customizations: jsonText('customizations').default(jsonDefault('{}')), // For UI customization options

    // Authentication options
    authType: indexableText('auth_type').notNull().default('public'), // 'public', 'password', 'email', 'sso'
    password: text('password'), // Stored hashed, populated when authType is 'password'
    allowedEmails: jsonText('allowed_emails').default('[]'), // Array of allowed emails or domains when authType is 'email' or 'sso'

    // Output configuration
    outputConfigs: jsonText('output_configs').default('[]'), // Array of {blockId, path} objects

    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => {
    return {
      // Ensure identifiers are unique
      identifierIdx: uniqueIndex('identifier_idx').on(table.identifier),
    }
  }
)

export const form = pgTable(
  'form',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    identifier: indexableText('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isActive: booleanType('is_active').notNull().default(booleanDefault(true)),

    // UI/UX Customizations
    // { primaryColor, welcomeMessage, thankYouTitle, thankYouMessage, logoUrl }
    customizations: jsonText('customizations').default(jsonDefault('{}')),

    // Authentication options (following chat pattern)
    authType: indexableText('auth_type').notNull().default('public'), // 'public', 'password', 'email'
    password: text('password'), // Stored encrypted, populated when authType is 'password'
    allowedEmails: jsonText('allowed_emails').default('[]'), // Array of allowed emails or domains

    // Branding
    showBranding: booleanType('show_branding').notNull().default(booleanDefault(true)),

    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    identifierIdx: uniqueIndex('form_identifier_idx').on(table.identifier),
    workflowIdIdx: index('form_workflow_id_idx').on(table.workflowId),
    userIdIdx: index('form_user_id_idx').on(table.userId),
  })
)

export const organization = pgTable('organization', {
  id: indexableText('id').primaryKey(),
  name: text('name').notNull(),
  slug: indexableText('slug').notNull(),
  logo: text('logo'),
  metadata: jsonText('metadata'),
  orgUsageLimit: decimal('org_usage_limit'),
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  departedMemberUsage: decimal('departed_member_usage').notNull().default('0'),
  creditBalance: decimal('credit_balance').notNull().default('0'),
  createdAt: timestampWithDefault('created_at'),
  updatedAt: timestampWithDefault('updated_at'),
})

export const member = pgTable(
  'member',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: indexableText('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: indexableText('role').notNull(), // 'admin' or 'member' - team-level permissions only
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    userIdUnique: uniqueIndex('member_user_id_unique').on(table.userId), // Users can only belong to one org
    organizationIdIdx: index('member_organization_id_idx').on(table.organizationId),
  })
)

export const invitation = pgTable(
  'invitation',
  {
    id: indexableText('id').primaryKey(),
    email: indexableText('email').notNull(),
    inviterId: indexableText('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: indexableText('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: indexableText('role').notNull(),
    status: indexableText('status').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    emailIdx: index('invitation_email_idx').on(table.email),
    organizationIdIdx: index('invitation_organization_id_idx').on(table.organizationId),
  })
)

export const workspace = pgTable('workspace', {
  id: indexableText('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: indexableText('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  billedAccountUserId: indexableText('billed_account_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'no action' }),
  allowPersonalApiKeys: booleanType('allow_personal_api_keys')
    .notNull()
    .default(booleanDefault(true)),
  createdAt: timestampWithDefault('created_at'),
  updatedAt: timestampWithDefault('updated_at'),
})

export const workspaceFile = pgTable(
  'workspace_file',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: indexableTextLong('key').notNull().unique(),
    size: integer('size').notNull(),
    type: text('type').notNull(),
    uploadedBy: indexableText('uploaded_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    uploadedAt: timestampWithDefault('uploaded_at'),
  },
  (table) => ({
    workspaceIdIdx: index('workspace_file_workspace_id_idx').on(table.workspaceId),
    keyIdx: index('workspace_file_key_idx').on(table.key),
  })
)

export const workspaceFiles = pgTable(
  'workspace_files',
  {
    id: indexableText('id').primaryKey(),
    key: indexableTextLong('key').notNull().unique(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: indexableText('workspace_id').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    context: indexableText('context').notNull(), // 'workspace', 'copilot', 'chat', 'knowledge-base', 'profile-pictures', 'general', 'execution'
    originalName: text('original_name').notNull(),
    contentType: indexableText('content_type').notNull(),
    size: integer('size').notNull(),
    uploadedAt: timestampWithDefault('uploaded_at'),
  },
  (table) => ({
    keyIdx: index('workspace_files_key_idx').on(table.key),
    userIdIdx: index('workspace_files_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workspace_files_workspace_id_idx').on(table.workspaceId),
    contextIdx: index('workspace_files_context_idx').on(table.context),
  })
)

export const permissionKindEnum = pgEnum('permission_kind', ['admin', 'write', 'read'])

export const workspaceInvitationStatusEnum = pgEnum('workspace_invitation_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
])

export type WorkspaceInvitationStatus = (typeof workspaceInvitationStatusEnum.enumValues)[number]

export const workspaceInvitation = pgTable('workspace_invitation', {
  id: indexableText('id').primaryKey(),
  workspaceId: indexableText('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  email: indexableText('email').notNull(),
  inviterId: indexableText('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: indexableText('role').notNull().default('member'),
  status: enumColumn('status', workspaceInvitationStatusEnum).notNull().default('pending'),
  token: indexableTextLong('token').notNull().unique(),
  permissions: enumColumn('permissions', permissionKindEnum).notNull().default('admin'),
  orgInvitationId: indexableText('org_invitation_id'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestampWithDefault('created_at'),
  updatedAt: timestampWithDefault('updated_at'),
})

export const permissions = pgTable(
  'permissions',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityKind: indexableText('entity_kind').notNull(), // 'workspace', 'workflow', 'organization', etc.
    entityId: indexableText('entity_id').notNull(), // ID of the workspace, workflow, etc.
    permissionKind: enumColumn('permission_kind', permissionKindEnum).notNull(), // Use enum instead of text
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    // Primary access pattern - get all permissions for a user
    userIdIdx: index('permissions_user_id_idx').on(table.userId),

    // Entity-based queries - get all users with permissions on an entity
    entityIdx: index('permissions_entity_idx').on(table.entityKind, table.entityId),

    // User + entity type queries - get user's permissions for all workspaces
    userEntityTypeIdx: index('permissions_user_entity_kind_idx').on(table.userId, table.entityKind),

    // Specific permission checks - does user have specific permission on entity
    userEntityPermissionIdx: index('permissions_user_entity_permission_idx').on(
      table.userId,
      table.entityKind,
      table.permissionKind
    ),

    // User + specific entity queries - get user's permissions for specific entity
    userEntityIdx: index('permissions_user_entity_idx').on(
      table.userId,
      table.entityKind,
      table.entityId
    ),

    // Uniqueness constraint - prevent duplicate permission rows (one permission per user/entity)
    uniquePermissionConstraint: uniqueIndex('permissions_unique_constraint').on(
      table.userId,
      table.entityKind,
      table.entityId
    ),
  })
)

export const memory = pgTable(
  'memory',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    key: indexableTextLong('key').notNull(),
    data: jsonbText('data').notNull(),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => {
    return {
      keyIdx: index('memory_key_idx').on(table.key),
      workspaceIdx: index('memory_workspace_idx').on(table.workspaceId),
      uniqueKeyPerWorkspaceIdx: uniqueIndex('memory_workspace_key_idx').on(
        table.workspaceId,
        table.key
      ),
    }
  }
)

export const knowledgeBase = pgTable(
  'knowledge_base',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: indexableText('workspace_id').references(() => workspace.id),
    name: text('name').notNull(),
    description: text('description'),

    // Token tracking for usage
    tokenCount: integer('token_count').notNull().default(0),

    // Embedding configuration
    embeddingModel: indexableText('embedding_model').notNull().default('text-embedding-3-small'),
    embeddingDimension: integer('embedding_dimension').notNull().default(1536),

    // Chunking configuration stored as JSON for flexibility
    chunkingConfig: jsonText('chunking_config')
      .notNull()
      .default(jsonDefault('{"maxSize": 1024, "minSize": 1, "overlap": 200}')),

    // Soft delete support
    deletedAt: timestamp('deleted_at'),

    // Metadata and timestamps
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('kb_user_id_idx').on(table.userId),
    workspaceIdIdx: index('kb_workspace_id_idx').on(table.workspaceId),
    // Composite index for user's workspaces
    userWorkspaceIdx: index('kb_user_workspace_idx').on(table.userId, table.workspaceId),
    // Index for soft delete filtering
    deletedAtIdx: index('kb_deleted_at_idx').on(table.deletedAt),
  })
)

export const document = pgTable(
  'document',
  {
    id: indexableText('id').primaryKey(),
    knowledgeBaseId: indexableText('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),

    // File information
    filename: text('filename').notNull(),
    fileUrl: indexableTextLong('file_url').notNull(),
    fileSize: integer('file_size').notNull(), // Size in bytes
    mimeType: indexableText('mime_type').notNull(), // e.g., 'application/pdf', 'text/plain'

    // Content statistics
    chunkCount: integer('chunk_count').notNull().default(0),
    tokenCount: integer('token_count').notNull().default(0),
    characterCount: integer('character_count').notNull().default(0),

    // Processing status
    processingStatus: indexableText('processing_status').notNull().default('pending'), // 'pending', 'processing', 'completed', 'failed'
    processingStartedAt: timestamp('processing_started_at'),
    processingCompletedAt: timestamp('processing_completed_at'),
    processingError: text('processing_error'),

    // Document state
    enabled: booleanType('enabled').notNull().default(booleanDefault(true)), // Enable/disable from knowledge base
    deletedAt: timestamp('deleted_at'), // Soft delete

    // Document tags for filtering (inherited by all chunks)
    // Text tags (7 slots)
    tag1: indexableText('tag1'),
    tag2: indexableText('tag2'),
    tag3: indexableText('tag3'),
    tag4: indexableText('tag4'),
    tag5: indexableText('tag5'),
    tag6: indexableText('tag6'),
    tag7: indexableText('tag7'),
    // Number tags (5 slots)
    number1: doublePrecision('number1'),
    number2: doublePrecision('number2'),
    number3: doublePrecision('number3'),
    number4: doublePrecision('number4'),
    number5: doublePrecision('number5'),
    // Date tags (2 slots)
    date1: timestamp('date1'),
    date2: timestamp('date2'),
    // Boolean tags (3 slots)
    boolean1: booleanType('boolean1'),
    boolean2: booleanType('boolean2'),
    boolean3: booleanType('boolean3'),

    // Timestamps
    uploadedAt: timestampWithDefault('uploaded_at'),
  },
  (table) => ({
    // Primary access pattern - filter by knowledge base
    knowledgeBaseIdIdx: index('doc_kb_id_idx').on(table.knowledgeBaseId),
    // Search by filename
    filenameIdx: index('doc_filename_idx').on(table.filename),
    // Processing status filtering
    processingStatusIdx: index('doc_processing_status_idx').on(
      table.knowledgeBaseId,
      table.processingStatus
    ),
    // Text tag indexes
    tag1Idx: index('doc_tag1_idx').on(table.tag1),
    tag2Idx: index('doc_tag2_idx').on(table.tag2),
    tag3Idx: index('doc_tag3_idx').on(table.tag3),
    tag4Idx: index('doc_tag4_idx').on(table.tag4),
    tag5Idx: index('doc_tag5_idx').on(table.tag5),
    tag6Idx: index('doc_tag6_idx').on(table.tag6),
    tag7Idx: index('doc_tag7_idx').on(table.tag7),
    // Number tag indexes (5 slots)
    number1Idx: index('doc_number1_idx').on(table.number1),
    number2Idx: index('doc_number2_idx').on(table.number2),
    number3Idx: index('doc_number3_idx').on(table.number3),
    number4Idx: index('doc_number4_idx').on(table.number4),
    number5Idx: index('doc_number5_idx').on(table.number5),
    // Date tag indexes (2 slots)
    date1Idx: index('doc_date1_idx').on(table.date1),
    date2Idx: index('doc_date2_idx').on(table.date2),
    // Boolean tag indexes (3 slots)
    boolean1Idx: index('doc_boolean1_idx').on(table.boolean1),
    boolean2Idx: index('doc_boolean2_idx').on(table.boolean2),
    boolean3Idx: index('doc_boolean3_idx').on(table.boolean3),
  })
)

export const knowledgeBaseTagDefinitions = pgTable(
  'knowledge_base_tag_definitions',
  {
    id: indexableText('id').primaryKey(),
    knowledgeBaseId: indexableText('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),
    tagSlot: indexableText('tag_slot', {
      enum: TAG_SLOTS,
    }).notNull(),
    displayName: indexableText('display_name').notNull(),
    fieldType: indexableText('field_type').notNull().default('text'), // 'text', future: 'date', 'number', 'range'
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    // Ensure unique tag slot per knowledge base
    kbTagSlotIdx: uniqueIndex('kb_tag_definitions_kb_slot_idx').on(
      table.knowledgeBaseId,
      table.tagSlot
    ),
    // Ensure unique display name per knowledge base
    kbDisplayNameIdx: uniqueIndex('kb_tag_definitions_kb_display_name_idx').on(
      table.knowledgeBaseId,
      table.displayName
    ),
    // Index for querying by knowledge base
    kbIdIdx: index('kb_tag_definitions_kb_id_idx').on(table.knowledgeBaseId),
  })
)

export const embedding = pgTable(
  'embedding',
  {
    id: indexableText('id').primaryKey(),
    knowledgeBaseId: indexableText('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),
    documentId: indexableText('document_id')
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),

    // Chunk information
    chunkIndex: integer('chunk_index').notNull(),
    chunkHash: indexableText('chunk_hash').notNull(),
    content: text('content').notNull(),
    contentLength: integer('content_length').notNull(),
    tokenCount: integer('token_count').notNull(),

    // Vector embeddings - optimized for text-embedding-3-small with HNSW support
    embedding: vector('embedding', { dimensions: 1536 }), // For text-embedding-3-small
    embeddingModel: indexableText('embedding_model').notNull().default('text-embedding-3-small'),

    // Chunk boundaries and overlap
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),

    // Tag columns inherited from document for efficient filtering
    // Text tags (7 slots)
    tag1: indexableText('tag1'),
    tag2: indexableText('tag2'),
    tag3: indexableText('tag3'),
    tag4: indexableText('tag4'),
    tag5: indexableText('tag5'),
    tag6: indexableText('tag6'),
    tag7: indexableText('tag7'),
    // Number tags (5 slots)
    number1: doublePrecision('number1'),
    number2: doublePrecision('number2'),
    number3: doublePrecision('number3'),
    number4: doublePrecision('number4'),
    number5: doublePrecision('number5'),
    // Date tags (2 slots)
    date1: timestamp('date1'),
    date2: timestamp('date2'),
    // Boolean tags (3 slots)
    boolean1: booleanType('boolean1'),
    boolean2: booleanType('boolean2'),
    boolean3: booleanType('boolean3'),

    // Chunk state - enable/disable from knowledge base
    enabled: booleanType('enabled').notNull().default(booleanDefault(true)),

    // Full-text search support - generated tsvector column
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${embedding.content})`
    ),

    // Timestamps
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    // Primary vector search pattern
    kbIdIdx: index('emb_kb_id_idx').on(table.knowledgeBaseId),

    // Document-level access
    docIdIdx: index('emb_doc_id_idx').on(table.documentId),

    // Chunk ordering within documents
    docChunkIdx: uniqueIndex('emb_doc_chunk_idx').on(table.documentId, table.chunkIndex),

    // Model-specific queries for A/B testing or migrations
    kbModelIdx: index('emb_kb_model_idx').on(table.knowledgeBaseId, table.embeddingModel),

    // Enabled state filtering indexes (for chunk enable/disable functionality)
    kbEnabledIdx: index('emb_kb_enabled_idx').on(table.knowledgeBaseId, table.enabled),
    docEnabledIdx: index('emb_doc_enabled_idx').on(table.documentId, table.enabled),

    // Vector similarity search indexes (HNSW) - optimized for small embeddings
    ...(IS_IRIS
      ? {}
      : {
          embeddingVectorHnswIdx: index('embedding_vector_hnsw_idx')
            .using('hnsw', table.embedding.op('vector_cosine_ops'))
            .with({
              m: 16,
              ef_construction: 64,
            }),
        }),

    // Text tag indexes
    tag1Idx: index('emb_tag1_idx').on(table.tag1),
    tag2Idx: index('emb_tag2_idx').on(table.tag2),
    tag3Idx: index('emb_tag3_idx').on(table.tag3),
    tag4Idx: index('emb_tag4_idx').on(table.tag4),
    tag5Idx: index('emb_tag5_idx').on(table.tag5),
    tag6Idx: index('emb_tag6_idx').on(table.tag6),
    tag7Idx: index('emb_tag7_idx').on(table.tag7),
    // Number tag indexes (5 slots)
    number1Idx: index('emb_number1_idx').on(table.number1),
    number2Idx: index('emb_number2_idx').on(table.number2),
    number3Idx: index('emb_number3_idx').on(table.number3),
    number4Idx: index('emb_number4_idx').on(table.number4),
    number5Idx: index('emb_number5_idx').on(table.number5),
    // Date tag indexes (2 slots)
    date1Idx: index('emb_date1_idx').on(table.date1),
    date2Idx: index('emb_date2_idx').on(table.date2),
    // Boolean tag indexes (3 slots)
    boolean1Idx: index('emb_boolean1_idx').on(table.boolean1),
    boolean2Idx: index('emb_boolean2_idx').on(table.boolean2),
    boolean3Idx: index('emb_boolean3_idx').on(table.boolean3),

    // Full-text search index
    ...(IS_IRIS
      ? {}
      : { contentFtsIdx: index('emb_content_fts_idx').using('gin', table.contentTsv) }),

    // Ensure embedding exists (simplified since we only support one model)
    ...(IS_IRIS
      ? {}
      : {
          embeddingNotNullCheck: check('embedding_not_null_check', sql`"embedding" IS NOT NULL`),
        }),
  })
)

export const docsEmbeddings = pgTable(
  'docs_embeddings',
  {
    chunkId: indexableText('chunk_id').primaryKey(),
    chunkText: text('chunk_text').notNull(),
    sourceDocument: indexableText('source_document').notNull(),
    sourceLink: indexableTextLong('source_link').notNull(),
    headerText: text('header_text').notNull(),
    headerLevel: integer('header_level').notNull(),
    tokenCount: integer('token_count').notNull(),

    // Vector embedding - optimized for text-embedding-3-small with HNSW support
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    embeddingModel: indexableText('embedding_model').notNull().default('text-embedding-3-small'),

    // Metadata for flexible filtering
    metadata: jsonbText('metadata').notNull().default(jsonDefault('{}')),

    // Full-text search support - generated tsvector column
    chunkTextTsv: tsvector('chunk_text_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${docsEmbeddings.chunkText})`
    ),
  },
  (table) => ({
    // Vector similarity search index (HNSW)
    ...(IS_IRIS
      ? {}
      : {
          embeddingVectorHnswIdx: index('docs_embedding_vector_hnsw_idx')
            .using('hnsw', table.embedding.op('vector_cosine_ops'))
            .with({
              m: 16,
              ef_construction: 64,
            }),
        }),

    // Full-text search index
    ...(IS_IRIS
      ? {}
      : { chunkTextFtsIdx: index('docs_chunk_text_fts_idx').using('gin', table.chunkTextTsv) }),

    // Metadata index for efficient JSON queries
    ...(IS_IRIS ? {} : { metadataIdx: index('docs_metadata_idx').using('gin', table.metadata) }),
  })
)

export const copilotChats = pgTable(
  'copilot_chats',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    title: text('title'),
    messages: jsonbText('messages').notNull().default(jsonDefault('[]')),
    model: indexableText('model').notNull().default('claude-3-7-sonnet-latest'),
    conversationId: indexableText('conversation_id'),
    previewYaml: text('preview_yaml'),
    planArtifact: text('plan_artifact'),
    config: jsonbText('config'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    userIdIdx: index('copilot_chats_user_id_idx').on(table.userId),
    workflowIdIdx: index('copilot_chats_workflow_id_idx').on(table.workflowId),
    userWorkflowIdx: index('copilot_chats_user_workflow_idx').on(table.userId, table.workflowId),
    createdAtIdx: index('copilot_chats_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('copilot_chats_updated_at_idx').on(table.updatedAt),
  })
)

export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: indexableText('id').primaryKey(),
    chatId: indexableText('chat_id')
      .notNull()
      .references(() => copilotChats.id, { onDelete: 'cascade' }),
    role: indexableText('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    diff: text('diff'),
    metadata: jsonbText('metadata'),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    chatIdIdx: index('copilot_messages_chat_id_idx').on(table.chatId),
  })
)

export const workflowCheckpoints = pgTable(
  'workflow_checkpoints',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    name: text('name'),
    data: jsonbText('data').notNull(), // Full workflow definition at checkpoint
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_checkpoints_workflow_id_idx').on(table.workflowId),
  })
)

export const templates = pgTable(
  'templates',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id').references(() => workflow.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    details: jsonbText('details'),
    isPublished: booleanType('is_published').notNull().default(booleanDefault(false)),
    author: text('author'),
    category: indexableText('category'),
    description: text('description'),
    color: indexableText('color').notNull().default('#3972F6'),
    useCount: integer('use_count').notNull().default(0),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    categoryIdx: index('templates_category_idx').on(table.category),
    isPublishedIdx: index('templates_is_published_idx').on(table.isPublished),
  })
)

export const templateStars = pgTable(
  'template_stars',
  {
    id: indexableText('id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    templateId: indexableText('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    userIdIdx: index('template_stars_user_id_idx').on(table.userId),
    templateIdIdx: index('template_stars_template_id_idx').on(table.templateId),
    uniqueStar: uniqueIndex('template_stars_unique_idx').on(table.userId, table.templateId),
  })
)

export const copilotFeedback = pgTable(
  'copilot_feedback',
  {
    feedbackId: indexableText('feedback_id').primaryKey(),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    messageId: indexableText('message_id').notNull(),
    rating: integer('rating').notNull(), // 1 for positive, -1 for negative
    comment: text('feedback_text'),
    metadata: jsonbText('metadata'),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    userIdIdx: index('copilot_feedback_user_id_idx').on(table.userId),
    messageIdIdx: index('copilot_feedback_message_id_idx').on(table.messageId),
  })
)

export const workflowDeploymentVersion = pgTable(
  'workflow_deployment_version',
  {
    id: indexableText('id').primaryKey(),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonbText('definition').notNull(),
    description: text('description'),
    deployedBy: indexableText('deployed_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_deployment_workflow_id_idx').on(table.workflowId),
    uniqueVersion: uniqueIndex('workflow_deployment_workflow_version_unique').on(
      table.workflowId,
      table.version
    ),
  })
)

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: indexableTextLong('key').notNull(),
    namespace: indexableText('namespace').notNull().default('default'),
    result: jsonText('result').notNull(),
    createdAt: timestampWithDefault('created_at'),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.namespace, table.key] }),
    expiresAtIdx: index('idempotency_key_expires_at_idx').on(table.expiresAt),
  })
)

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Track who created the server, but workspace owns it
    createdBy: indexableText('created_by').references(() => user.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    description: text('description'),

    transport: indexableText('transport').notNull(),
    url: text('url'),

    headers: jsonText('headers').default(jsonDefault('{}')),
    timeout: integer('timeout').default(30000),
    retries: integer('retries').default(3),

    enabled: booleanWithDefault('enabled', true),
    lastConnected: timestamp('last_connected'),
    connectionStatus: indexableText('connection_status').default('disconnected'),
    lastError: text('last_error'),

    statusConfig: jsonbText('status_config').default(jsonDefault('{}')),

    toolCount: integer('tool_count').default(0),
    lastToolsRefresh: timestamp('last_tools_refresh'),
    totalRequests: integer('total_requests').default(0),
    lastUsed: timestamp('last_used'),

    deletedAt: timestamp('deleted_at'),

    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    // Primary access pattern - active servers by workspace
    workspaceEnabledIdx: index('mcp_servers_workspace_enabled_idx').on(
      table.workspaceId,
      table.enabled
    ),
    // Soft delete pattern - workspace + not deleted
    workspaceDeletedIdx: index('mcp_servers_workspace_deleted_idx').on(
      table.workspaceId,
      table.deletedAt
    ),
  })
)

export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: indexableText('id').primaryKey(),
    issuer: indexableTextLong('issuer').notNull(),
    domain: indexableText('domain').notNull(),
    oidcConfig: text('oidc_config'),
    samlConfig: text('saml_config'),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: indexableText('provider_id').notNull(),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    issuerIdx: index('sso_provider_issuer_idx').on(table.issuer),
    domainIdx: index('sso_provider_domain_idx').on(table.domain),
    userIdIdx: index('sso_provider_user_id_idx').on(table.userId),
  })
)

export const workflowMcpServer = pgTable(
  'workflow_mcp_server',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    createdBy: indexableText('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    type: indexableText('type').notNull(), // 'builtin', 'custom'
    baseUrl: indexableTextLong('base_url').notNull(),
    apiKey: text('api_key'),
    status: indexableText('status').notNull().default('active'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('workflow_mcp_server_workspace_id_idx').on(table.workspaceId),
    statusIdx: index('workflow_mcp_server_status_idx').on(table.status),
  })
)

export const workflowMcpTool = pgTable(
  'workflow_mcp_tool',
  {
    id: indexableText('id').primaryKey(),
    serverId: indexableText('server_id')
      .notNull()
      .references(() => workflowMcpServer.id, { onDelete: 'cascade' }),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    toolName: indexableText('tool_name').notNull(),
    description: text('description'),
    inputSchema: jsonbText('input_schema'),
    isEnabled: booleanType('is_enabled').notNull().default(booleanDefault(true)),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    serverIdIdx: index('workflow_mcp_tool_server_id_idx').on(table.serverId),
    workflowIdIdx: index('workflow_mcp_tool_workflow_id_idx').on(table.workflowId),
    uniqueTool: uniqueIndex('workflow_mcp_tool_unique_idx').on(table.workflowId, table.toolName),
  })
)

export const a2aAgent = pgTable(
  'a2a_agent',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    workflowId: indexableText('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    createdBy: indexableText('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    agentName: text('agent_name').notNull(),
    description: text('description'),
    protocol: indexableText('protocol').notNull().default('a2a'),
    endpointUrl: indexableTextLong('endpoint_url').notNull(),
    authToken: text('api_key'),
    status: indexableText('status').notNull().default('active'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('a2a_agent_workspace_id_idx').on(table.workspaceId),
    workflowIdIdx: index('a2a_agent_workflow_id_idx').on(table.workflowId),
    statusIdx: index('a2a_agent_status_idx').on(table.status),
  })
)

export const credentialSet = pgTable(
  'credential_set',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    providerId: indexableText('provider_id').notNull(),
    config: jsonbText('config').notNull(),
    encryptedCredentials: text('encrypted_credentials'),
    isActive: booleanType('is_active').notNull().default(booleanDefault(true)),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('credential_set_workspace_id_idx').on(table.workspaceId),
    providerIdIdx: index('credential_set_provider_id_idx').on(table.providerId),
  })
)

export const credentialSetMembership = pgTable(
  'credential_set_membership',
  {
    id: indexableText('id').primaryKey(),
    credentialSetId: indexableText('credential_set_id')
      .notNull()
      .references(() => credentialSet.id, { onDelete: 'cascade' }),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: indexableText('role').notNull().default('member'), // 'owner', 'admin', 'member'
    status: indexableText('status').notNull().default('active'), // 'active', 'pending'
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    credentialSetIdIdx: index('credential_set_membership_set_id_idx').on(table.credentialSetId),
    userIdIdx: index('credential_set_membership_user_id_idx').on(table.userId),
    uniqueMember: uniqueIndex('credential_set_membership_unique_idx').on(
      table.credentialSetId,
      table.userId
    ),
  })
)

export const credentialSetInvitation = pgTable(
  'credential_set_invitation',
  {
    id: indexableText('id').primaryKey(),
    credentialSetId: indexableText('credential_set_id')
      .notNull()
      .references(() => credentialSet.id, { onDelete: 'cascade' }),
    email: indexableText('email').notNull(),
    inviterId: indexableText('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: indexableText('role').notNull().default('member'),
    status: indexableText('status').notNull().default('pending'),
    token: indexableTextLong('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    credentialSetIdIdx: index('credential_set_invitation_set_id_idx').on(table.credentialSetId),
    emailIdx: index('credential_set_invitation_email_idx').on(table.email),
  })
)

export const permissionGroup = pgTable(
  'permission_group',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    permissions: jsonbText('permissions').notNull().default('[]'), // Array of permission strings or objects
    isActive: booleanType('is_active').notNull().default(booleanDefault(true)),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('permission_group_workspace_id_idx').on(table.workspaceId),
  })
)

export const permissionGroupMember = pgTable(
  'permission_group_member',
  {
    id: indexableText('id').primaryKey(),
    groupId: indexableText('group_id')
      .notNull()
      .references(() => permissionGroup.id, { onDelete: 'cascade' }),
    userId: indexableText('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestampWithDefault('created_at'),
  },
  (table) => ({
    groupIdIdx: index('permission_group_member_group_id_idx').on(table.groupId),
    userIdIdx: index('permission_group_member_user_id_idx').on(table.userId),
    uniqueMember: uniqueIndex('permission_group_member_unique_idx').on(table.groupId, table.userId),
  })
)

export const a2aTask = pgTable(
  'a2a_task',
  {
    id: indexableText('id').primaryKey(),
    workspaceId: indexableText('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    agentId: indexableText('agent_id')
      .notNull()
      .references(() => a2aAgent.id, { onDelete: 'cascade' }),
    taskType: indexableText('task_type').notNull(),
    input: jsonbText('input').notNull(),
    output: jsonbText('output'),
    status: indexableText('status').notNull().default('pending'),
    error: text('error'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestampWithDefault('created_at'),
    updatedAt: timestampWithDefault('updated_at'),
  },
  (table) => ({
    workspaceIdIdx: index('a2a_task_workspace_id_idx').on(table.workspaceId),
    agentIdIdx: index('a2a_task_agent_id_idx').on(table.agentId),
    statusIdx: index('a2a_task_status_idx').on(table.status),
  })
)
