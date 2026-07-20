import { type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  decimal,
  doublePrecision,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { DEFAULT_FREE_CREDITS, TAG_SLOTS } from './constants'

// Custom tsvector type for full-text search
export const tsvector = customType<{
  data: string
}>({
  dataType() {
    return `tsvector`
  },
})

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  normalizedEmail: text('normalized_email').unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  role: text('role').default('user'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => ({
    userIdIdx: index('session_user_id_idx').on(table.userId),
    tokenIdx: index('session_token_idx').on(table.token),
  })
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    userIdIdx: index('account_user_id_idx').on(table.userId),
    accountProviderIdx: index('idx_account_on_account_id_provider_id').on(
      table.accountId,
      table.providerId
    ),
  })
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => ({
    identifierIdx: index('verification_identifier_idx').on(table.identifier),
    expiresAtIdx: index('verification_expires_at_idx').on(table.expiresAt),
  })
)

export const workflowFolder = pgTable(
  'workflow_folder',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'), // Self-reference will be handled by foreign key constraint
    color: text('color').default('#6B7280'),
    isExpanded: boolean('is_expanded').notNull().default(true),
    locked: boolean('locked').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    archivedAt: timestamp('archived_at'),
  },
  (table) => ({
    userIdx: index('workflow_folder_user_idx').on(table.userId),
    workspaceParentIdx: index('workflow_folder_workspace_parent_idx').on(
      table.workspaceId,
      table.parentId
    ),
    parentSortIdx: index('workflow_folder_parent_sort_idx').on(table.parentId, table.sortOrder),
    archivedAtIdx: index('workflow_folder_archived_at_idx').on(table.archivedAt),
    workspaceArchivedAtPartialIdx: index('workflow_folder_workspace_archived_partial_idx')
      .on(table.workspaceId, table.archivedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
  })
)

export const workflow = pgTable(
  'workflow',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => workflowFolder.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    description: text('description'),
    lastSynced: timestamp('last_synced').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    isDeployed: boolean('is_deployed').notNull().default(false),
    deployedAt: timestamp('deployed_at'),
    isPublicApi: boolean('is_public_api').notNull().default(false),
    locked: boolean('locked').notNull().default(false),
    forkSyncExcluded: boolean('fork_sync_excluded').notNull().default(false),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at'),
    variables: json('variables').default('{}'),
    archivedAt: timestamp('archived_at'),
  },
  (table) => ({
    userIdIdx: index('workflow_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workflow_workspace_id_idx').on(table.workspaceId),
    userWorkspaceIdx: index('workflow_user_workspace_idx').on(table.userId, table.workspaceId),
    workspaceFolderNameUnique: uniqueIndex('workflow_workspace_folder_name_active_unique')
      .on(table.workspaceId, sql`coalesce(${table.folderId}, '')`, table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    folderSortIdx: index('workflow_folder_sort_idx').on(table.folderId, table.sortOrder),
    archivedAtIdx: index('workflow_archived_at_idx').on(table.archivedAt),
    workspaceArchivedAtPartialIdx: index('workflow_workspace_archived_partial_idx')
      .on(table.workspaceId, table.archivedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
  })
)

export const workflowBlocks = pgTable(
  'workflow_blocks',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // 'starter', 'agent', 'api', 'function'
    name: text('name').notNull(),

    positionX: decimal('position_x').notNull(),
    positionY: decimal('position_y').notNull(),

    enabled: boolean('enabled').notNull().default(true),
    horizontalHandles: boolean('horizontal_handles').notNull().default(true),
    isWide: boolean('is_wide').notNull().default(false),
    advancedMode: boolean('advanced_mode').notNull().default(false),
    triggerMode: boolean('trigger_mode').notNull().default(false),
    locked: boolean('locked').notNull().default(false),
    height: decimal('height').notNull().default('0'),

    subBlocks: jsonb('sub_blocks').notNull().default('{}'),
    outputs: jsonb('outputs').notNull().default('{}'),
    data: jsonb('data').default('{}'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_blocks_workflow_id_idx').on(table.workflowId),
    typeIdx: index('workflow_blocks_type_idx').on(table.type),
  })
)

export const workflowEdges = pgTable(
  'workflow_edges',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    sourceBlockId: text('source_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    targetBlockId: text('target_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    sourceHandle: text('source_handle'),
    targetHandle: text('target_handle'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
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
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // 'loop' or 'parallel'
    config: jsonb('config').notNull().default('{}'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_subflows_workflow_id_idx').on(table.workflowId),
    workflowTypeIdx: index('workflow_subflows_workflow_type_idx').on(table.workflowId, table.type),
  })
)

export const waitlist = pgTable('waitlist', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending, approved, rejected
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workflowExecutionSnapshots = pgTable(
  'workflow_execution_snapshots',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    stateHash: text('state_hash').notNull(),
    stateData: jsonb('state_data').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
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
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    stateSnapshotId: text('state_snapshot_id')
      .notNull()
      .references(() => workflowExecutionSnapshots.id),
    deploymentVersionId: text('deployment_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'set null' }
    ),

    level: text('level').notNull(), // 'info' | 'error'
    status: text('status').notNull().default('running'), // 'running' | 'pending' | 'completed' | 'failed' | 'cancelled'
    trigger: text('trigger').notNull(), // 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'

    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    totalDurationMs: integer('total_duration_ms'),

    /**
     * Heavy trace data (traceSpans, finalOutput, workflowInput, executionState)
     * is externalized to object storage; this column then holds a slim payload:
     * a `traceStoreRef` (__simLargeValueRef) pointer to the stored object plus
     * inline markers (hasTraceSpans, traceSpanCount, environment, trigger,
     * truncation flags). It also still holds the FULL payload inline for legacy
     * / not-yet-backfilled rows, for the storage-write-failure fallback, and for
     * job_execution_logs. Required — not droppable. Read it via
     * `materializeExecutionData`, which resolves the pointer.
     */
    executionData: jsonb('execution_data').notNull().default('{}'),
    /** @deprecated Not written/read; cost lives in usage_log + the `cost_total` projection. Drop in a follow-up PR after the `cost_total` backfill. */
    cost: jsonb('cost'),
    // Faithful, write-once projection of the run's usage_log ledger sum (dollars).
    // Backs list cost display/filter/sort without live aggregation; never an
    // independently-computed value (cost_total == SUM(usage_log) for the run).
    costTotal: decimal('cost_total'),
    // Model names used by the run (incl. zero-cost/BYOK), for the v1 model filter.
    modelsUsed: text('models_used').array(),
    files: jsonb('files'), // File metadata for execution files
    createdAt: timestamp('created_at').notNull().defaultNow(),
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
    workspaceStartedAtIdDescIdx: index(
      'workflow_execution_logs_workspace_started_at_id_desc_idx'
    ).on(table.workspaceId, sql`${table.startedAt} DESC NULLS LAST`, sql`${table.id} DESC`),
    workspaceCostTotalIdx: index('workflow_execution_logs_workspace_cost_total_idx').on(
      table.workspaceId,
      table.costTotal
    ),
    modelsUsedIdx: index('workflow_execution_logs_models_used_idx').using('gin', table.modelsUsed),
    workspaceEndedAtIdIdx: index('workflow_execution_logs_workspace_ended_at_id_idx').on(
      table.workspaceId,
      sql`date_trunc('milliseconds', ${table.endedAt})`,
      table.id
    ),
    runningStartedAtIdx: index('workflow_execution_logs_running_started_at_idx')
      .on(table.startedAt)
      .where(sql`status = 'running'`),
    completedEndedAtIdx: index('workflow_execution_logs_completed_ended_at_idx')
      .on(table.endedAt, table.workspaceId, table.executionId)
      .where(
        sql`${table.status} = 'completed' AND ${table.level} = 'info' AND ${table.endedAt} IS NOT NULL`
      ),
  })
)

export const executionLargeValueReferenceSourceEnum = pgEnum(
  'execution_large_value_reference_source',
  ['execution_log', 'paused_snapshot']
)

export const executionLargeValues = pgTable(
  'execution_large_values',
  {
    key: text('key').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    ownerExecutionId: text('owner_execution_id').notNull(),
    size: integer('size').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    ownerExecutionIdIdx: index('execution_large_values_owner_execution_id_idx').on(
      table.ownerExecutionId
    ),
    cleanupIdx: index('execution_large_values_cleanup_idx')
      .on(table.workspaceId, table.createdAt, table.key)
      .where(sql`${table.deletedAt} IS NULL`),
    tombstoneCleanupIdx: index('execution_large_values_tombstone_cleanup_idx')
      .on(table.workspaceId, table.deletedAt, table.key)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
)

export const executionLargeValueReferences = pgTable(
  'execution_large_value_references',
  {
    key: text('key').notNull(),
    executionId: text('execution_id').notNull(),
    source: executionLargeValueReferenceSourceEnum('source').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.executionId, table.source] }),
    workspaceExecutionSourceIdx: index(
      'execution_large_value_references_workspace_execution_source_idx'
    ).on(table.workspaceId, table.executionId, table.source),
  })
)

export const executionLargeValueDependencies = pgTable(
  'execution_large_value_dependencies',
  {
    parentKey: text('parent_key').notNull(),
    childKey: text('child_key').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentKey, table.childKey] }),
    workspaceParentKeyIdx: index('execution_large_value_dependencies_workspace_parent_key_idx').on(
      table.workspaceId,
      table.parentKey
    ),
    workspaceChildKeyIdx: index('execution_large_value_dependencies_workspace_child_key_idx').on(
      table.workspaceId,
      table.childKey
    ),
  })
)

export const pausedExecutions = pgTable(
  'paused_executions',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    executionSnapshot: jsonb('execution_snapshot').notNull(),
    pausePoints: jsonb('pause_points').notNull(),
    totalPauseCount: integer('total_pause_count').notNull(),
    resumedCount: integer('resumed_count').notNull().default(0),
    automaticResumeRetryCount: integer('automatic_resume_retry_count').notNull().default(0),
    status: text('status').notNull().default('paused'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    pausedAt: timestamp('paused_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    /** Earliest `resumeAt` across this row's time-based pause points. NULL for human-only pauses. */
    nextResumeAt: timestamp('next_resume_at'),
  },
  (table) => ({
    workflowIdx: index('paused_executions_workflow_id_idx').on(table.workflowId),
    statusIdx: index('paused_executions_status_idx').on(table.status),
    executionUnique: uniqueIndex('paused_executions_execution_id_unique').on(table.executionId),
    nextResumeAtIdx: index('paused_executions_next_resume_at_idx')
      .on(table.nextResumeAt)
      .where(sql`status = 'paused' AND next_resume_at IS NOT NULL`),
  })
)

export const resumeQueue = pgTable(
  'resume_queue',
  {
    id: text('id').primaryKey(),
    pausedExecutionId: text('paused_execution_id')
      .notNull()
      .references(() => pausedExecutions.id, { onDelete: 'cascade' }),
    parentExecutionId: text('parent_execution_id').notNull(),
    newExecutionId: text('new_execution_id').notNull(),
    contextId: text('context_id').notNull(),
    resumeInput: jsonb('resume_input'),
    status: text('status').notNull().default('pending'),
    queuedAt: timestamp('queued_at').notNull().defaultNow(),
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
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One environment per user
  variables: json('variables').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workspaceEnvironment = pgTable(
  'workspace_environment',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    variables: json('variables').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex('workspace_environment_workspace_unique').on(table.workspaceId),
  })
)

export const workspaceBYOKKeys = pgTable(
  'workspace_byok_keys',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    name: text('name'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceProviderIdx: index('workspace_byok_workspace_provider_idx').on(
      table.workspaceId,
      table.providerId
    ),
  })
)

export const settings = pgTable('settings', {
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One settings record per user

  // General settings
  theme: text('theme').notNull().default('system'),
  autoConnect: boolean('auto_connect').notNull().default(true),

  // Privacy settings
  telemetryEnabled: boolean('telemetry_enabled').notNull().default(true),

  // Email preferences
  emailPreferences: json('email_preferences').notNull().default('{}'),

  // Billing usage notifications preference
  billingUsageNotificationsEnabled: boolean('billing_usage_notifications_enabled')
    .notNull()
    .default(true),

  // UI preferences
  showTrainingControls: boolean('show_training_controls').notNull().default(false),
  superUserModeEnabled: boolean('super_user_mode_enabled').notNull().default(true),
  mothershipEnvironment: text('mothership_environment').notNull().default('default'),

  // Notification preferences
  errorNotificationsEnabled: boolean('error_notifications_enabled').notNull().default(true),

  // Canvas preferences
  snapToGridSize: integer('snap_to_grid_size').notNull().default(0), // 0 = off, 10-50 = grid size
  showActionBar: boolean('show_action_bar').notNull().default(true),

  timezone: text('timezone'),

  // Copilot preferences - maps model_id to enabled/disabled boolean
  copilotEnabledModels: jsonb('copilot_enabled_models').notNull().default('{}'),

  // Copilot auto-allowed integration tools - array of tool IDs that can run without confirmation
  copilotAutoAllowedTools: jsonb('copilot_auto_allowed_tools').notNull().default('[]'),

  // Workspace navigation
  lastActiveWorkspaceId: text('last_active_workspace_id'),

  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workflowSchedule = pgTable(
  'workflow_schedule',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'cascade' }),
    deploymentVersionId: text('deployment_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'cascade' }
    ),
    deploymentOperationId: text('deployment_operation_id').references(
      (): AnyPgColumn => workflowDeploymentOperation.id,
      { onDelete: 'set null' }
    ),
    blockId: text('block_id'),
    cronExpression: text('cron_expression'),
    nextRunAt: timestamp('next_run_at'),
    lastRanAt: timestamp('last_ran_at'),
    lastQueuedAt: timestamp('last_queued_at'),
    triggerType: text('trigger_type').notNull(), // "manual", "webhook", "schedule"
    timezone: text('timezone').notNull().default('UTC'),
    failedCount: integer('failed_count').notNull().default(0),
    infraRetryCount: integer('infra_retry_count').notNull().default(0),
    status: text('status').notNull().default('active'), // 'active', 'disabled', or 'completed'
    lastFailedAt: timestamp('last_failed_at'),
    sourceType: text('source_type').notNull().default('workflow'), // 'workflow' or 'job'
    jobTitle: text('job_title'),
    prompt: text('prompt'),
    lifecycle: text('lifecycle').notNull().default('persistent'), // 'persistent' or 'until_complete'
    successCondition: text('success_condition'),
    maxRuns: integer('max_runs'),
    runCount: integer('run_count').notNull().default(0),
    sourceChatId: text('source_chat_id'),
    sourceTaskName: text('source_task_name'),
    sourceUserId: text('source_user_id').references(() => user.id, { onDelete: 'cascade' }),
    sourceWorkspaceId: text('source_workspace_id').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    jobHistory: jsonb('job_history').$type<Array<{ timestamp: string; summary: string }>>(),
    /** `@`-mentioned resources / `/`-invoked skills captured with the prompt, resolved into the agent run at fire time. */
    contexts: jsonb('contexts').$type<Array<Record<string, unknown>>>(),
    /** ISO timestamps of recurring occurrences the user deleted individually (EXDATE); the executor skips them. */
    excludedDates: jsonb('excluded_dates').$type<string[]>(),
    /** Recurrence end boundary: the schedule completes once its next run would fall after this instant. */
    endsAt: timestamp('ends_at'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      workflowBlockUnique: uniqueIndex('workflow_schedule_workflow_block_deployment_unique')
        .on(table.workflowId, table.blockId, table.deploymentVersionId)
        .where(sql`${table.archivedAt} IS NULL`),
      workflowDeploymentIdx: index('workflow_schedule_workflow_deployment_idx').on(
        table.workflowId,
        table.deploymentVersionId
      ),
      archivedAtPartialIdx: index('workflow_schedule_archived_at_partial_idx')
        .on(table.archivedAt)
        .where(sql`${table.archivedAt} IS NOT NULL`),
      sourceWorkspaceSourceTypeIdx: index(
        'idx_workflow_schedule_on_source_workspace_id_source_t_c07f3bba6'
      ).on(table.sourceWorkspaceId, table.sourceType, table.archivedAt, table.status),
      dueWorkflowIdx: index('workflow_schedule_due_workflow_idx')
        .on(table.nextRunAt, table.lastQueuedAt, table.deploymentVersionId, table.workflowId)
        .where(
          sql`${table.archivedAt} IS NULL AND ${table.status} NOT IN ('disabled', 'completed') AND (${table.sourceType} = 'workflow' OR ${table.sourceType} IS NULL)`
        ),
      dueJobIdx: index('workflow_schedule_due_job_idx')
        .on(table.nextRunAt, table.lastQueuedAt)
        .where(
          sql`${table.archivedAt} IS NULL AND ${table.status} NOT IN ('disabled', 'completed') AND ${table.sourceType} = 'job'`
        ),
    }
  }
)

export const jobExecutionLogs = pgTable(
  'job_execution_logs',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id').references(() => workflowSchedule.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    level: text('level').notNull(),
    status: text('status').notNull().default('running'),
    trigger: text('trigger').notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    totalDurationMs: integer('total_duration_ms'),
    executionData: jsonb('execution_data').notNull().default('{}'),
    cost: jsonb('cost'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    scheduleIdIdx: index('job_execution_logs_schedule_id_idx').on(table.scheduleId),
    workspaceStartedAtIdx: index('job_execution_logs_workspace_started_at_idx').on(
      table.workspaceId,
      table.startedAt
    ),
    workspaceEndedAtIdIdx: index('job_execution_logs_workspace_ended_at_id_idx').on(
      table.workspaceId,
      sql`date_trunc('milliseconds', ${table.endedAt})`,
      table.id
    ),
    executionIdUnique: uniqueIndex('job_execution_logs_execution_id_unique').on(table.executionId),
    triggerIdx: index('job_execution_logs_trigger_idx').on(table.trigger),
  })
)

/** Extracts the canonical credential ID persisted in webhook provider configuration. */
export function webhookCredentialIdExpression(column: AnyPgColumn): SQL<string> {
  return sql<string>`((${column})::jsonb ->> 'credentialId')`
}

export const webhook = pgTable(
  'webhook',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    deploymentVersionId: text('deployment_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'cascade' }
    ),
    registrationStatus: text('registration_status'),
    registrationGeneration: integer('registration_generation'),
    configFingerprint: text('config_fingerprint'),
    preparedAt: timestamp('prepared_at'),
    blockId: text('block_id'),
    /**
     * URL-addressable webhook path. NULL for shared-app providers (e.g. the
     * native Slack OAuth trigger) whose events arrive on a single shared
     * endpoint and route by `routingKey` instead of a per-workflow path.
     */
    path: text('path'),
    /**
     * Tenant routing key for shared-app providers. For `provider='slack_app'`
     * this is the Slack `team_id`, derived server-side from the connected
     * credential at deploy time — never user input. Inbound events match on
     * this after HMAC verification.
     */
    routingKey: text('routing_key'),
    provider: text('provider'), // e.g., "whatsapp", "github", etc.
    providerConfig: json('provider_config'), // Store provider-specific configuration
    isActive: boolean('is_active').notNull().default(true),
    failedCount: integer('failed_count').default(0), // Track consecutive failures
    lastFailedAt: timestamp('last_failed_at'), // When the webhook last failed
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure webhook paths are unique per deployment version
      pathIdx: uniqueIndex('path_deployment_unique')
        .on(table.path, table.deploymentVersionId)
        .where(sql`${table.archivedAt} IS NULL`),
      workflowDeploymentIdx: index('webhook_workflow_deployment_idx').on(
        table.workflowId,
        table.deploymentVersionId
      ),
      // Shared-app inbound routing (Slack native OAuth trigger). routingKey leads.
      routingKeyActiveIdx: index('webhook_routing_key_active_idx')
        .on(table.routingKey, table.provider)
        .where(sql`${table.archivedAt} IS NULL AND ${table.routingKey} IS NOT NULL`),
      archivedAtPartialIdx: index('webhook_archived_at_partial_idx')
        .on(table.archivedAt)
        .where(sql`${table.archivedAt} IS NOT NULL`),
      providerActiveWorkflowDeploymentIdx: index(
        'idx_webhook_on_provider_is_active_workflow_id_deploym_bdeed5468'
      ).on(table.provider, table.isActive, table.workflowId, table.deploymentVersionId),
      tiktokCredentialIdIdx: index('webhook_tiktok_credential_id_idx')
        .on(webhookCredentialIdExpression(table.providerConfig))
        .where(
          sql`${table.provider} = 'tiktok' AND ${table.isActive} = true AND ${table.archivedAt} IS NULL`
        ),
      workflowBlockUpdatedDescIdx: index('idx_webhook_on_workflow_id_block_id_updated_at_desc').on(
        table.workflowId,
        table.blockId,
        table.updatedAt.desc()
      ),
      activeRegistrationUnique: uniqueIndex('webhook_active_registration_unique')
        .on(table.workflowId, table.blockId)
        .where(
          sql`${table.registrationStatus} = 'active' AND ${table.blockId} IS NOT NULL AND ${table.archivedAt} IS NULL`
        ),
      candidateRegistrationUnique: uniqueIndex('webhook_candidate_registration_unique')
        .on(table.workflowId, table.blockId)
        .where(sql`${table.registrationStatus} = 'candidate' AND ${table.blockId} IS NOT NULL`),
      registrationGenerationIdx: index('webhook_registration_status_generation_idx').on(
        table.workflowId,
        table.registrationStatus,
        table.registrationGeneration
      ),
      registrationStatusCheck: check(
        'webhook_registration_status_check',
        sql`${table.registrationStatus} IS NULL OR ${table.registrationStatus} IN ('active', 'candidate', 'retired', 'orphaned')`
      ),
      registrationGenerationCheck: check(
        'webhook_registration_generation_check',
        sql`${table.registrationGeneration} IS NULL OR ${table.registrationGeneration} >= 0`
      ),
    }
  }
)

/**
 * Owns a normalized path independently from registration generations.
 */
export const webhookPathClaim = pgTable(
  'webhook_path_claim',
  {
    path: text('path').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdx: index('webhook_path_claim_workflow_idx').on(table.workflowId),
    generationCheck: check('webhook_path_claim_generation_check', sql`${table.generation} >= 0`),
  })
)

/**
 * Cooldown state for Sim workspace-event trigger subscriptions.
 *
 * Keyed by (workflowId, blockId, scopeKey) rather than the webhook row because
 * webhook rows are recreated per deployment version — state stored there would
 * reset on every redeploy. `scopeKey` is '' for subscription-level cooldowns
 * and the source workflow ID for per-source-workflow rules (no_activity).
 */
export const simTriggerState = pgTable(
  'sim_trigger_state',
  {
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull(),
    scopeKey: text('scope_key').notNull().default(''),
    lastFiredAt: timestamp('last_fired_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workflowId, table.blockId, table.scopeKey] }),
  })
)

export const apiKey = pgTable(
  'api_key',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }), // Only set for workspace keys
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    keyHash: text('key_hash'),
    type: text('type').notNull().default('personal'),
    lastUsed: timestamp('last_used'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => ({
    workspaceTypeCheck: check(
      'workspace_type_check',
      sql`(type = 'workspace' AND workspace_id IS NOT NULL) OR (type = 'personal' AND workspace_id IS NULL)`
    ),
    workspaceTypeIdx: index('api_key_workspace_type_idx').on(table.workspaceId, table.type),
    userTypeIdx: index('api_key_user_type_idx').on(table.userId, table.type),
    keyHashIdx: uniqueIndex('api_key_key_hash_idx').on(table.keyHash),
  })
)

export const billingBlockedReasonEnum = pgEnum('billing_blocked_reason', [
  'payment_failed',
  'dispute',
])

export const billingEntityTypeEnum = pgEnum('billing_entity_type', ['user', 'organization'])

export const userStats = pgTable('user_stats', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One record per user
  // Retired usage hot-path counters: no writers/readers; derive from usage_log.
  // Drop via DROP COLUMN in a follow-up migration.
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalManualExecutions: integer('total_manual_executions').notNull().default(0),
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalApiCalls: integer('total_api_calls').notNull().default(0),
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalWebhookTriggers: integer('total_webhook_triggers').notNull().default(0),
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalScheduledExecutions: integer('total_scheduled_executions').notNull().default(0),
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalChatExecutions: integer('total_chat_executions').notNull().default(0),
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalMcpExecutions: integer('total_mcp_executions').notNull().default(0),
  /** @deprecated Retired usage counter; derive from usage_log. */
  totalTokensUsed: bigint('total_tokens_used', { mode: 'number' }).notNull().default(0),
  /** @deprecated Not written (recordUsage appends to usage_log); legacy/admin reads only. Move readers to ledger aggregation. */
  totalCost: decimal('total_cost').notNull().default('0'),
  currentUsageLimit: decimal('current_usage_limit').default(DEFAULT_FREE_CREDITS.toString()), // Default $5 (1,000 credits) for free plan, null for team/enterprise
  usageLimitUpdatedAt: timestamp('usage_limit_updated_at').defaultNow(),
  /**
   * Active per-period baseline (not a per-usage hot-path counter). Current usage
   * = this baseline + attributed usage_log rows for the period; reset at rollover.
   */
  currentPeriodCost: decimal('current_period_cost').notNull().default('0'),
  lastPeriodCost: decimal('last_period_cost').default('0'), // Usage from previous billing period
  /**
   * Threshold/final billing tracker.
   *
   * This is intentionally still written when threshold billing or invoice
   * finalization serializes overage collection. It is not incremented by the
   * ordinary per-usage ledger write path.
   */
  billedOverageThisPeriod: decimal('billed_overage_this_period').notNull().default('0'), // Amount of overage already billed via threshold billing
  // Pro usage snapshot when joining a team (to prevent double-billing)
  proPeriodCostSnapshot: decimal('pro_period_cost_snapshot').default('0'), // Snapshot of Pro usage when joining team
  proPeriodCostSnapshotAt: timestamp('pro_period_cost_snapshot_at'), // When the snapshot was captured (= join moment). Used to cap daily-refresh computation so post-join refresh isn't deducted from pre-join personal Pro usage (and vice-versa for the org's pooled refresh).
  /**
   * Credit balance tracker.
   *
   * Still debited/credited by billing lifecycle paths and threshold/final
   * overage collection. It is not a per-usage aggregate counter.
   */
  creditBalance: decimal('credit_balance').notNull().default('0'),
  /** @deprecated Not written; report Copilot cost from usage_log. Legacy/admin reads only. */
  totalCopilotCost: decimal('total_copilot_cost').notNull().default('0'),
  /** Active per-period Copilot baseline; reset at rollover (not a per-usage counter). */
  currentPeriodCopilotCost: decimal('current_period_copilot_cost').notNull().default('0'),
  /** Previous-period Copilot cost; set at rollover. */
  lastPeriodCopilotCost: decimal('last_period_copilot_cost').default('0'),
  /** @deprecated Not written; report Copilot tokens from usage_log. Legacy/admin reads only. */
  totalCopilotTokens: bigint('total_copilot_tokens', { mode: 'number' }).notNull().default(0),
  /** @deprecated Not written; report Copilot calls from usage_log. Legacy/admin reads only. */
  totalCopilotCalls: integer('total_copilot_calls').notNull().default(0),
  /** @deprecated Not written; report MCP Copilot calls from usage_log. Legacy/admin reads only. */
  totalMcpCopilotCalls: integer('total_mcp_copilot_calls').notNull().default(0),
  /** @deprecated Not written; report MCP Copilot cost from usage_log. Legacy/admin reads only. */
  totalMcpCopilotCost: decimal('total_mcp_copilot_cost').notNull().default('0'),
  /** @deprecated No writer (never incremented or reset). MCP copilot usage lives in usage_log (source 'mcp_copilot'); read it from there, not this column. */
  currentPeriodMcpCopilotCost: decimal('current_period_mcp_copilot_cost').notNull().default('0'),
  /**
   * Storage upload/delete hot-path tracker for personal plans.
   *
   * This remains a direct aggregate write for personal file storage changes;
   * org-scoped storage writes update `organization.storageUsedBytes`.
   */
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  /** @deprecated Not updated by execution (no user_stats write on completion); legacy/admin reads only. */
  lastActive: timestamp('last_active').notNull().defaultNow(),
  billingBlocked: boolean('billing_blocked').notNull().default(false),
  billingBlockedReason: billingBlockedReasonEnum('billing_blocked_reason'),
  /**
   * Highest usage-limit threshold already emailed per category (e.g.
   * `{ storage: 80, tables: 100 }`). Prevents re-spamming the same warning;
   * re-arms when usage drops back below the re-arm band. Keyed by limit
   * category ('storage' | 'tables'); seats live on `organization`.
   *
   * Dedup granularity is per billing account per category — intentionally NOT
   * per table, so a user hitting the row limit on several tables gets one
   * 'tables' warning, not one per table (the email still names the table that
   * triggered it).
   */
  limitNotifications: jsonb('limit_notifications')
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
})

export const customTools = pgTable(
  'custom_tools',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    schema: json('schema').notNull(),
    code: text('code').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('custom_tools_workspace_id_idx').on(table.workspaceId),
    workspaceTitleUnique: uniqueIndex('custom_tools_workspace_title_unique').on(
      table.workspaceId,
      table.title
    ),
  })
)

export const skill = pgTable(
  'skill',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceNameUnique: uniqueIndex('skill_workspace_name_unique').on(
      table.workspaceId,
      table.name
    ),
  })
)

export const mothershipSettings = pgTable(
  'mothership_settings',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    mcpToolRefs: jsonb('mcp_tool_refs').notNull().default(sql`'[]'::jsonb`),
    customToolRefs: jsonb('custom_tool_refs').notNull().default(sql`'[]'::jsonb`),
    skillRefs: jsonb('skill_refs').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('mothership_settings_workspace_id_idx').on(table.workspaceId),
  })
)

export const subscription = pgTable(
  'subscription',
  {
    id: text('id').primaryKey(),
    plan: text('plan').notNull(),
    referenceId: text('reference_id').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    status: text('status'),
    periodStart: timestamp('period_start'),
    periodEnd: timestamp('period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end'),
    cancelAt: timestamp('cancel_at'),
    canceledAt: timestamp('canceled_at'),
    endedAt: timestamp('ended_at'),
    seats: integer('seats'),
    trialStart: timestamp('trial_start'),
    trialEnd: timestamp('trial_end'),
    billingInterval: text('billing_interval'),
    stripeScheduleId: text('stripe_schedule_id'),
    metadata: json('metadata'),
  },
  (table) => ({
    referenceStatusIdx: index('subscription_reference_status_idx').on(
      table.referenceId,
      table.status
    ),
    enterpriseMetadataCheck: check(
      'check_enterprise_metadata',
      sql`plan != 'enterprise' OR metadata IS NOT NULL`
    ),
  })
)

export const rateLimitBucket = pgTable('rate_limit_bucket', {
  key: text('key').primaryKey(),
  tokens: decimal('tokens').notNull(),
  lastRefillAt: timestamp('last_refill_at').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const chat = pgTable(
  'chat',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    customizations: json('customizations').default('{}'), // For UI customization options

    // Authentication options
    authType: text('auth_type').notNull().default('public'), // 'public', 'password', 'email', 'sso'
    password: text('password'), // Stored hashed, populated when authType is 'password'
    allowedEmails: json('allowed_emails').default('[]'), // Array of allowed emails or domains when authType is 'email' or 'sso'

    // Output configuration
    outputConfigs: json('output_configs').default('[]'), // Array of {blockId, path} objects

    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure identifiers are unique
      identifierIdx: uniqueIndex('identifier_idx')
        .on(table.identifier)
        .where(sql`${table.archivedAt} IS NULL`),
      archivedAtPartialIdx: index('chat_archived_at_partial_idx')
        .on(table.archivedAt)
        .where(sql`${table.archivedAt} IS NOT NULL`),
      workflowArchivedAtIdx: index('idx_chat_on_workflow_id_archived_at').on(
        table.workflowId,
        table.archivedAt
      ),
    }
  }
)

/** A user-supplied custom regex pattern; matches are replaced verbatim with `replacement`. */
export interface CustomPiiPattern {
  name: string
  regex: string
  replacement: string
}

/** Per-stage PII redaction policy stored on a {@link PiiRedactionRule}. */
export interface PiiStagePolicy {
  enabled: boolean
  /** Presidio entity types to mask. Empty (or disabled) = redact nothing. */
  entityTypes: string[]
  /** Language whose Presidio recognizers apply (e.g. 'en', 'es'); defaults to English. */
  language?: string
  /** User-supplied custom regex patterns applied alongside `entityTypes`. */
  customPatterns?: CustomPiiPattern[]
}

/**
 * A single PII redaction rule. Lives in the org-level
 * {@link DataRetentionSettings.piiRedaction} rules list. Each rule targets one
 * scope — all workspaces (`workspaceId: null`) or a single workspace — and
 * `workspaceId` is unique across rules. Resolution is most-specific-wins: a
 * workspace's own rule overrides the all-workspaces rule (never unioned).
 *
 * New rules carry per-stage {@link stages} (input / blockOutputs / logs); legacy
 * rows carry only the flat `entityTypes`/`language`, resolved as a logs-only
 * rule. At least one of the two is present.
 */
export interface PiiRedactionRule {
  id: string
  name?: string
  /** `null` = all workspaces; otherwise the single targeted workspace. */
  workspaceId: string | null
  /** Per-stage policy (input redaction, block-output redaction, log redaction). */
  stages?: {
    input: PiiStagePolicy
    blockOutputs: PiiStagePolicy
    logs: PiiStagePolicy
  }
  /** Legacy flat policy (pre-stages). Presidio entity types masked at log persist. */
  entityTypes?: string[]
  /** Legacy flat language (pre-stages). */
  language?: string
}

/**
 * A per-workspace override of the org-level retention hours. Each field is
 * tri-state: absent = inherit the org value; a number = that workspace's
 * retention in hours; `null` = forever (never delete). `workspaceId` is unique
 * across overrides.
 */
export interface RetentionOverride {
  workspaceId: string
  logRetentionHours?: number | null
  softDeleteRetentionHours?: number | null
  taskCleanupHours?: number | null
}

/**
 * Org-level data retention + governance settings. Retention-hours fall back to
 * plan defaults when unset. `piiRedaction.rules` are org-scoped; each rule
 * selects which workspaces it applies to. `retentionOverrides` lets individual
 * workspaces override the org retention hours (enterprise only).
 */
export interface DataRetentionSettings {
  logRetentionHours?: number | null
  softDeleteRetentionHours?: number | null
  taskCleanupHours?: number | null
  /** Enterprise PII redaction rules applied to workflow logs on persist. */
  piiRedaction?: {
    rules?: PiiRedactionRule[]
  } | null
  /** Per-workspace overrides of the retention hours above (enterprise only). */
  retentionOverrides?: RetentionOverride[] | null
}

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: json('metadata'),
  whitelabelSettings: json('whitelabel_settings').$type<{
    brandName?: string
    logoUrl?: string
    primaryColor?: string
    primaryHoverColor?: string
    accentColor?: string
    accentHoverColor?: string
    supportEmail?: string
    documentationUrl?: string
    termsUrl?: string
    privacyUrl?: string
    hidePoweredBySim?: boolean
  }>(),
  dataRetentionSettings: json('data_retention_settings').$type<DataRetentionSettings>(),
  orgUsageLimit: decimal('org_usage_limit'),
  /**
   * Storage upload/delete hot-path tracker for org-scoped plans.
   *
   * This remains a direct aggregate write for organization file storage
   * changes; personal storage writes update `user_stats.storageUsedBytes`.
   */
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  /**
   * Highest usage-limit threshold already emailed per category for this org
   * (e.g. `{ seats: 80, storage: 100 }`). Mirrors `user_stats.limitNotifications`
   * for org-scoped (pooled) limits. Re-arms when usage drops below the re-arm band.
   */
  limitNotifications: jsonb('limit_notifications')
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  departedMemberUsage: decimal('departed_member_usage').notNull().default('0'),
  /**
   * Organization credit balance tracker.
   *
   * Still debited/credited by billing lifecycle paths and threshold/final
   * overage collection. It is not a per-usage aggregate counter.
   */
  creditBalance: decimal('credit_balance').notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'admin' or 'member' - team-level permissions only
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdUnique: uniqueIndex('member_user_id_unique').on(table.userId), // Users can only belong to one org
    organizationIdIdx: index('member_organization_id_idx').on(table.organizationId),
  })
)

/**
 * Per-member usage limit (in dollars) scoped to a single organization.
 *
 * Keyed by `(organizationId, userId)` so it covers both organization members
 * (rows in `member`) and external members (users with workspace permissions in
 * org-owned workspaces but no `member` row). Independent of
 * `user_stats.current_usage_limit`, which is the user's personal subscription
 * cap and is nulled for org-scoped members. An absent row means "no per-member
 * cap" (only the pooled org limit applies). Enforced for usage in org-owned
 * workspaces; hosted-only.
 */
export const organizationMemberUsageLimit = pgTable(
  'organization_member_usage_limit',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    usageLimit: decimal('usage_limit').notNull(),
    /** Admin who set the cap (audit only). Soft FK: nulled if that user is
     *  deleted so the member's limit row survives — never cascade-deleted. */
    setBy: text('set_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgUserUnique: uniqueIndex('org_member_usage_limit_org_user_unique').on(
      table.organizationId,
      table.userId
    ),
    organizationIdIdx: index('org_member_usage_limit_organization_id_idx').on(table.organizationId),
  })
)

export const invitationKindEnum = pgEnum('invitation_kind', ['organization', 'workspace'])

export type InvitationKind = (typeof invitationKindEnum.enumValues)[number]

export const invitationMembershipIntentEnum = pgEnum('invitation_membership_intent', [
  'internal',
  'external',
])

export type InvitationMembershipIntent = (typeof invitationMembershipIntentEnum.enumValues)[number]

export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
  'expired',
])

export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number]

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    kind: invitationKindEnum('kind').notNull().default('organization'),
    email: text('email').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    membershipIntent: invitationMembershipIntentEnum('membership_intent')
      .notNull()
      .default('internal'),
    role: text('role').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('invitation_email_idx').on(table.email),
    organizationIdIdx: index('invitation_organization_id_idx').on(table.organizationId),
    statusIdx: index('invitation_status_idx').on(table.status),
    pendingPerOrgEmailUnique: uniqueIndex('invitation_pending_email_org_unique')
      .on(table.email, table.organizationId)
      .where(sql`${table.status} = 'pending' AND ${table.organizationId} IS NOT NULL`),
  })
)

export const workspaceModeEnum = pgEnum('workspace_mode', [
  'personal',
  'organization',
  'grandfathered_shared',
])

export type WorkspaceMode = (typeof workspaceModeEnum.enumValues)[number]

export const workspace = pgTable(
  'workspace',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#33C482'),
    logoUrl: text('logo_url'),
    /**
     * @deprecated Not a permission or identity concept — do not use for admin/access
     * checks. The owner→admin derivation is redundant: every workspace owner already
     * has an explicit `admin` row in `permissions` (verified across all production
     * workspaces) and all creation paths add one. Retained only as the lifecycle
     * anchor — `onDelete: 'cascade'` cleans up a user's workspaces on account
     * deletion — and the ownership-transfer target when an owner is removed. For
     * admin checks use explicit `permissions` rows; for the workspace's principal
     * billing identity use `billedAccountUserId`. DO NOT DELETE.
     */
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    workspaceMode: workspaceModeEnum('workspace_mode').notNull().default('grandfathered_shared'),
    billedAccountUserId: text('billed_account_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'no action' }),
    /**
     * Durable workspace-first storage ledger.
     *
     * Invariant: this non-negative total and the currently routed payer aggregate
     * change atomically while the workspace row is locked. A payer identity change
     * moves this entire total old payer -> new payer in the same transaction.
     */
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
    allowPersonalApiKeys: boolean('allow_personal_api_keys').notNull().default(true),
    inboxEnabled: boolean('inbox_enabled').notNull().default(false),
    inboxAddress: text('inbox_address'),
    inboxProviderId: text('inbox_provider_id'),
    archivedAt: timestamp('archived_at'),
    organizationAssignedAt: timestamp('organization_assigned_at'),
    forkedFromWorkspaceId: text('forked_from_workspace_id').references(
      (): AnyPgColumn => workspace.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerIdIdx: index('workspace_owner_id_idx').on(table.ownerId),
    organizationIdIdx: index('workspace_organization_id_idx').on(table.organizationId),
    nonNegativeStorage: check(
      'workspace_storage_used_bytes_non_negative',
      sql`${table.storageUsedBytes} >= 0`
    ),
    workspaceModeIdx: index('workspace_mode_idx').on(table.workspaceMode),
    forkedFromWorkspaceIdx: index('workspace_forked_from_workspace_id_idx').on(
      table.forkedFromWorkspaceId
    ),
  })
)

export const workspaceForkResourceTypeEnum = pgEnum('workspace_fork_resource_type', [
  'workflow',
  'oauth_credential',
  'service_account_credential',
  'env_var',
  'table',
  'knowledge_base',
  'knowledge_document',
  'file',
  'mcp_server',
  /** Workflow-publishing MCP server identity (fork shell copy), for attachment sync. */
  'workflow_mcp_server',
  'custom_tool',
  'skill',
])

export const workspaceForkResourceMap = pgTable(
  'workspace_fork_resource_map',
  {
    id: text('id').primaryKey(),
    childWorkspaceId: text('child_workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    resourceType: workspaceForkResourceTypeEnum('resource_type').notNull(),
    parentResourceId: text('parent_resource_id').notNull(),
    childResourceId: text('child_resource_id'),
    // SET NULL (not CASCADE): deleting the creating user must not delete the fork's
    // identity mappings, which the edge depends on for every future promote.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    childWorkspaceIdx: index('workspace_fork_resource_map_child_ws_idx').on(table.childWorkspaceId),
    childWorkspaceTypeIdx: index('workspace_fork_resource_map_child_ws_type_idx').on(
      table.childWorkspaceId,
      table.resourceType
    ),
    childTypeParentUnique: uniqueIndex('workspace_fork_resource_map_child_type_parent_unique').on(
      table.childWorkspaceId,
      table.resourceType,
      table.parentResourceId
    ),
  })
)

/**
 * Stable 1:1 block-identity map between a fork (child) and its parent, per edge. Seeded at
 * fork creation (parent block -> derived child block) and reconciled on every promote.
 * Promote looks a source block up here to reuse its counterpart's EXISTING id instead of
 * re-deriving: without it, pushing a fork's workflow over the parent would re-key the
 * parent's blocks and change their webhook URLs (the path falls back to the block id).
 *
 * Each pair records BOTH workflow ids so a lookup can be scoped to the workflow it belongs
 * to: a target workflow that was archived and re-created gets a fresh id (the pair no longer
 * matches), which avoids reusing an archived workflow's block id and colliding on the global
 * `workflow_blocks` primary key. Block ids are plain text (no FK to `workflow_blocks`, which
 * is rewritten on every deploy); only the edge (`child_workspace_id`) cascades. A parent
 * block can map to different children across sibling forks, so uniqueness is per (edge,
 * parent) and per (edge, child).
 */
export const workspaceForkBlockMap = pgTable(
  'workspace_fork_block_map',
  {
    id: text('id').primaryKey(),
    childWorkspaceId: text('child_workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    parentWorkflowId: text('parent_workflow_id').notNull(),
    parentBlockId: text('parent_block_id').notNull(),
    childWorkflowId: text('child_workflow_id').notNull(),
    childBlockId: text('child_block_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Pull resolves parent source block -> child target; one child per parent block per edge.
    childWsParentBlockUnique: uniqueIndex('workspace_fork_block_map_child_ws_parent_unique').on(
      table.childWorkspaceId,
      table.parentBlockId
    ),
    // Push resolves child source block -> parent target; one parent per child block per edge.
    childWsChildBlockUnique: uniqueIndex('workspace_fork_block_map_child_ws_child_unique').on(
      table.childWorkspaceId,
      table.childBlockId
    ),
    // Reconcile deletes a source workflow's pairs by its (stable) workflow id before
    // re-inserting the live ones, so index both workflow sides for that sweep.
    childWsParentWorkflowIdx: index('workspace_fork_block_map_child_ws_parent_wf_idx').on(
      table.childWorkspaceId,
      table.parentWorkflowId
    ),
    childWsChildWorkflowIdx: index('workspace_fork_block_map_child_ws_child_wf_idx').on(
      table.childWorkspaceId,
      table.childWorkflowId
    ),
  })
)

/**
 * The user's stored dependent-field re-picks for an edge: a (target workflow, target block,
 * subblock) -> selected value mapping (a Gmail label, a KB document, a sheet tab). The sync
 * modal reads and writes this, and every promote applies it verbatim - it is the single
 * source of truth for dependent values, replacing the old implicit "preserve the target's
 * value if the credential is unchanged" path. Block ids are plain text (no FK to
 * `workflow_blocks`, which is rewritten on every deploy); only the edge (`child_workspace_id`)
 * cascades. The target workflow id encodes direction (push -> parent workflow, pull -> child
 * workflow), so no separate direction column is needed.
 */
export const workspaceForkDependentValue = pgTable(
  'workspace_fork_dependent_value',
  {
    id: text('id').primaryKey(),
    childWorkspaceId: text('child_workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    targetWorkflowId: text('target_workflow_id').notNull(),
    targetBlockId: text('target_block_id').notNull(),
    subBlockKey: text('sub_block_key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Reconcile replaces a workflow's stored values by its id, so index that sweep.
    childWsWorkflowIdx: index('workspace_fork_dependent_value_child_ws_wf_idx').on(
      table.childWorkspaceId,
      table.targetWorkflowId
    ),
    // One stored value per (edge, target workflow, target block, subblock).
    childWsFieldUnique: uniqueIndex('workspace_fork_dependent_value_field_unique').on(
      table.childWorkspaceId,
      table.targetWorkflowId,
      table.targetBlockId,
      table.subBlockKey
    ),
  })
)

export const workspaceForkPromoteDirectionEnum = pgEnum('workspace_fork_promote_direction', [
  'push',
  'pull',
])

export const workspaceForkPromoteRun = pgTable(
  'workspace_fork_promote_run',
  {
    id: text('id').primaryKey(),
    childWorkspaceId: text('child_workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    sourceWorkspaceId: text('source_workspace_id').notNull(),
    targetWorkspaceId: text('target_workspace_id').notNull(),
    direction: workspaceForkPromoteDirectionEnum('direction').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    // SET NULL (not CASCADE): deleting the creating user must not delete a pending
    // undo point for a target workspace.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // One undo point per (edge, target) so a push (target=parent) and a pull
    // (target=child) on the same edge keep independent undo points.
    childWorkspaceTargetUnique: uniqueIndex('workspace_fork_promote_run_child_ws_target_unique').on(
      table.childWorkspaceId,
      table.targetWorkspaceId
    ),
    targetWorkspaceIdx: index('workspace_fork_promote_run_target_ws_idx').on(
      table.targetWorkspaceId
    ),
  })
)

export const backgroundWorkKindEnum = pgEnum('background_work_kind', [
  'deployment_side_effects',
  'fork_content_copy',
  'fork_sync',
  'fork_rollback',
])

export const backgroundWorkStatusValueEnum = pgEnum('background_work_status_value', [
  'pending',
  'processing',
  'completed',
  'completed_with_warnings',
  'failed',
])

/**
 * Durable status for asynchronous background work (post-sync/rollback deployment
 * side-effects and fork content copy), so the canvas can show a "work in progress"
 * banner that survives a reload. A row scoped to a single workflow sets `workflowId`;
 * workspace-spanning work (fork content copy) leaves it null.
 */
export const backgroundWorkStatus = pgTable(
  'background_work_status',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'cascade' }),
    kind: backgroundWorkKindEnum('kind').notNull(),
    status: backgroundWorkStatusValueEnum('status').notNull(),
    message: text('message'),
    error: text('error'),
    metadata: jsonb('metadata'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceStatusIdx: index('background_work_status_workspace_status_idx').on(
      table.workspaceId,
      table.status
    ),
    workflowStatusIdx: index('background_work_status_workflow_status_idx').on(
      table.workflowId,
      table.status
    ),
    // Expression indexes for listSurfacedBackgroundWork's metadata legs: `->>` equality can't
    // use a GIN index, and one unindexable leg in its `or()` forces a full-table scan.
    metaChildWorkspaceIdx: index('background_work_status_meta_child_ws_idx').on(
      sql`(${table.metadata} ->> 'childWorkspaceId')`
    ),
    metaOtherWorkspaceIdx: index('background_work_status_meta_other_ws_idx').on(
      sql`(${table.metadata} ->> 'otherWorkspaceId')`
    ),
  })
)

export const workspaceFile = pgTable(
  'workspace_file',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    size: integer('size').notNull(),
    type: text('type').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('workspace_file_workspace_id_idx').on(table.workspaceId),
    keyIdx: index('workspace_file_key_idx').on(table.key),
    deletedAtIdx: index('workspace_file_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('workspace_file_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
)

export const workspaceFileFolder = pgTable(
  'workspace_file_folders',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => workspaceFileFolder.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceParentIdx: index('workspace_file_folders_workspace_parent_idx').on(
      table.workspaceId,
      table.parentId
    ),
    parentSortIdx: index('workspace_file_folders_parent_sort_idx').on(
      table.parentId,
      table.sortOrder
    ),
    deletedAtIdx: index('workspace_file_folders_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('workspace_file_folders_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
    workspaceParentNameActiveUnique: uniqueIndex(
      'workspace_file_folders_workspace_parent_name_active_unique'
    )
      .on(table.workspaceId, sql`coalesce(${table.parentId}, '')`, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
)

export const workspaceFiles = pgTable(
  'workspace_files',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => workspaceFileFolder.id, {
      onDelete: 'set null',
    }),
    context: text('context').notNull(), // 'workspace', 'mothership', 'copilot', 'chat', 'knowledge-base', 'profile-pictures', 'general', 'execution'
    chatId: uuid('chat_id').references(() => copilotChats.id, { onDelete: 'cascade' }),
    /**
     * Logical id of the copilot message this file was born in (the user message the
     * upload was attached to). Plain text with no FK: message ids are only unique per
     * chat — the same id legitimately exists in the source chat and every fork of it,
     * which is what lets a fork's "copy files at-or-before this message" cut match rows
     * in both. NULL means "birth unknown / not tracked": rows predating this column and
     * contexts that don't stamp it. Nulled together with chatId when a file is
     * materialized to the workspace.
     */
    messageId: text('message_id'),
    originalName: text('original_name').notNull(),
    /**
     * Collision-disambiguated name exposed to the copilot VFS as `uploads/<displayName>`.
     * For mothership chat uploads, identical originalNames within a chat get suffixed
     * `(2)`, `(3)`, ... in upload order so the VFS path is unique per chat.
     * NULL on legacy rows that predate this column — readers must coalesce to originalName.
     * Stable for the row's lifetime; the partial unique index below enforces uniqueness
     * for new (non-NULL) rows. NULLs are treated as distinct in PG unique indexes, so
     * legacy collisions remain (acceptable: those uploads have already happened).
     */
    displayName: text('display_name'),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    deletedAt: timestamp('deleted_at'),
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    keyActiveUniqueIdx: uniqueIndex('workspace_files_key_active_unique')
      .on(table.key)
      .where(sql`${table.deletedAt} IS NULL`),
    workspaceFolderOriginalNameActiveUnique: uniqueIndex(
      'workspace_files_workspace_folder_name_active_unique'
    )
      .on(table.workspaceId, sql`coalesce(${table.folderId}, '')`, table.originalName)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.context} = 'workspace' AND ${table.workspaceId} IS NOT NULL`
      ),
    /**
     * One display name per chat for mothership chat uploads, enforced across the row's
     * entire lifetime (including soft-deleted rows). VFS paths must remain stable for the
     * LLM's session — soft-deleting a sibling cannot free a name slot that the model has
     * already been told about, since that would cause `read("uploads/<name>")` to silently
     * resolve to a different file. NULLs are distinct in PG, so legacy rows (display_name
     * IS NULL) don't block index creation or new inserts.
     */
    chatDisplayNameUnique: uniqueIndex('workspace_files_chat_display_name_unique')
      .on(table.chatId, table.displayName)
      .where(sql`${table.context} = 'mothership' AND ${table.chatId} IS NOT NULL`),
    keyIdx: index('workspace_files_key_idx').on(table.key),
    userIdIdx: index('workspace_files_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workspace_files_workspace_id_idx').on(table.workspaceId),
    folderIdIdx: index('workspace_files_folder_id_idx').on(table.folderId),
    contextIdx: index('workspace_files_context_idx').on(table.context),
    chatIdIdx: index('workspace_files_chat_id_idx').on(table.chatId),
    deletedAtIdx: index('workspace_files_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('workspace_files_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
)

/**
 * Public share links for workspace resources. Polymorphic on `resourceType` so a
 * single mechanism serves files now and folders later. One row per resource
 * (disable/re-enable flips `isActive` and keeps the same token).
 */
export const publicShare = pgTable(
  'public_share',
  {
    id: text('id').primaryKey(),
    resourceType: text('resource_type').notNull(), // 'file' | 'folder' (folder reserved for future)
    resourceId: text('resource_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    // SET NULL (not CASCADE) so a share — and its public link — outlives the user
    // who created it; the file still belongs to the workspace.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    token: text('token').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // 'public' (anyone with the link) | 'password' | 'email' (OTP) | 'sso'.
    authType: text('auth_type').notNull().default('public'),
    // AES-256-GCM encrypted share password; null unless authType is 'password'.
    password: text('password'),
    // Allowed emails/domains (e.g. '@acme.com') when authType is 'email' or 'sso'.
    allowedEmails: json('allowed_emails').default('[]'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex('public_share_token_unique').on(table.token),
    resourceUniqueIdx: uniqueIndex('public_share_resource_unique').on(
      table.resourceType,
      table.resourceId
    ),
    resourceIdIdx: index('public_share_resource_id_idx').on(table.resourceId),
    workspaceIdIdx: index('public_share_workspace_id_idx').on(table.workspaceId),
  })
)

export const permissionTypeEnum = pgEnum('permission_type', ['admin', 'write', 'read'])

export const invitationWorkspaceGrant = pgTable(
  'invitation_workspace_grant',
  {
    id: text('id').primaryKey(),
    invitationId: text('invitation_id')
      .notNull()
      .references(() => invitation.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    permission: permissionTypeEnum('permission').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    invitationWorkspaceUnique: uniqueIndex('invitation_workspace_grant_unique').on(
      table.invitationId,
      table.workspaceId
    ),
    workspaceIdIdx: index('invitation_workspace_grant_workspace_id_idx').on(table.workspaceId),
  })
)

/**
 * Polymorphic access grants: `entityType` + `entityId` reference a workspace,
 * workflow, organization, etc. by id, but `entityId` is **not a foreign key** —
 * so deleting the referenced entity does NOT cascade-delete these rows. Soft
 * deletes (e.g. workspace archive) intentionally keep them: the entity is blocked
 * everywhere by its `archivedAt`, so the rows are harmless, and a future restore
 * would need them. Only a **hard** delete/purge of an entity must remove its
 * grants explicitly — e.g.
 * `DELETE FROM permissions WHERE entity_type = 'workspace' AND entity_id = $id` —
 * or they orphan.
 */
export const permissions = pgTable(
  'permissions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(), // 'workspace', 'workflow', 'organization', etc.
    entityId: text('entity_id').notNull(), // ID of the workspace, workflow, etc.
    permissionType: permissionTypeEnum('permission_type').notNull(), // Use enum instead of text
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern - get all permissions for a user
    userIdIdx: index('permissions_user_id_idx').on(table.userId),

    // Entity-based queries - get all users with permissions on an entity
    entityIdx: index('permissions_entity_idx').on(table.entityType, table.entityId),

    // User + entity type queries - get user's permissions for all workspaces
    userEntityTypeIdx: index('permissions_user_entity_type_idx').on(table.userId, table.entityType),

    // Specific permission checks - does user have specific permission on entity
    userEntityPermissionIdx: index('permissions_user_entity_permission_idx').on(
      table.userId,
      table.entityType,
      table.permissionType
    ),

    // User + specific entity queries - get user's permissions for specific entity
    userEntityIdx: index('permissions_user_entity_idx').on(
      table.userId,
      table.entityType,
      table.entityId
    ),

    // Uniqueness constraint - prevent duplicate permission rows (one permission per user/entity)
    uniquePermissionConstraint: uniqueIndex('permissions_unique_constraint').on(
      table.userId,
      table.entityType,
      table.entityId
    ),
  })
)

export const memory = pgTable(
  'memory',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
      workspaceDeletedAtPartialIdx: index('memory_workspace_deleted_partial_idx')
        .on(table.workspaceId, table.deletedAt)
        .where(sql`${table.deletedAt} IS NOT NULL`),
    }
  }
)

export const knowledgeBase = pgTable(
  'knowledge_base',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),

    // Token tracking for usage
    tokenCount: integer('token_count').notNull().default(0),

    // Embedding configuration
    embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),
    embeddingDimension: integer('embedding_dimension').notNull().default(1536),

    // Chunking configuration stored as JSON for flexibility
    chunkingConfig: json('chunking_config')
      .notNull()
      .default('{"maxSize": 1024, "minSize": 1, "overlap": 200}'),

    // Soft delete support
    deletedAt: timestamp('deleted_at'),

    // Metadata and timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('kb_user_id_idx').on(table.userId),
    workspaceIdIdx: index('kb_workspace_id_idx').on(table.workspaceId),
    // Composite index for user's workspaces
    userWorkspaceIdx: index('kb_user_workspace_idx').on(table.userId, table.workspaceId),
    // Index for soft delete filtering
    deletedAtIdx: index('kb_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('kb_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
    /** One active (non-deleted) name per workspace; matches user_table_definitions pattern */
    workspaceNameActiveUnique: uniqueIndex('kb_workspace_name_active_unique')
      .on(table.workspaceId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
)

export const document = pgTable(
  'document',
  {
    id: text('id').primaryKey(),
    knowledgeBaseId: text('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),

    // File information
    filename: text('filename').notNull(),
    fileUrl: text('file_url').notNull(),
    // Canonical storage key derived from fileUrl at write time (e.g. 'kb/<...>'),
    // or null for external/data: ingestion URLs. KB file authorization matches on
    // this exact key rather than re-parsing the URL at read time.
    storageKey: text('storage_key'),
    fileSize: integer('file_size').notNull(), // Size in bytes
    mimeType: text('mime_type').notNull(), // e.g., 'application/pdf', 'text/plain'

    // Content statistics
    chunkCount: integer('chunk_count').notNull().default(0),
    tokenCount: integer('token_count').notNull().default(0),
    characterCount: integer('character_count').notNull().default(0),

    // Processing status
    processingStatus: text('processing_status').notNull().default('pending'), // 'pending', 'processing', 'completed', 'failed'
    processingStartedAt: timestamp('processing_started_at'),
    processingCompletedAt: timestamp('processing_completed_at'),
    processingError: text('processing_error'),

    // Document state
    enabled: boolean('enabled').notNull().default(true), // Enable/disable from knowledge base
    archivedAt: timestamp('archived_at'), // Parent KB/workspace archive marker
    deletedAt: timestamp('deleted_at'), // Soft delete
    userExcluded: boolean('user_excluded').notNull().default(false), // User explicitly excluded — skip on sync

    // Document tags for filtering (inherited by all chunks)
    // Text tags (7 slots)
    tag1: text('tag1'),
    tag2: text('tag2'),
    tag3: text('tag3'),
    tag4: text('tag4'),
    tag5: text('tag5'),
    tag6: text('tag6'),
    tag7: text('tag7'),
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
    boolean1: boolean('boolean1'),
    boolean2: boolean('boolean2'),
    boolean3: boolean('boolean3'),

    // Connector-sourced document fields
    connectorId: text('connector_id').references(() => knowledgeConnector.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    contentHash: text('content_hash'),
    sourceUrl: text('source_url'),

    /** User who uploaded the document, for usage attribution. Null for
     *  connector/cron-synced docs (and pre-migration rows) → indexing billing
     *  falls back to the workspace billed account. */
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),

    // Timestamps
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
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
    // Connector document uniqueness (partial — only non-deleted rows)
    connectorExternalIdIdx: uniqueIndex('doc_connector_external_id_idx')
      .on(table.connectorId, table.externalId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Sync engine: load all active docs for a connector
    connectorIdIdx: index('doc_connector_id_idx').on(table.connectorId),
    // KB file-access liveness: exact lookup by canonical storage key
    storageKeyIdx: index('doc_storage_key_idx')
      .on(table.storageKey)
      .where(sql`${table.storageKey} IS NOT NULL`),
    archivedAtPartialIdx: index('doc_archived_at_partial_idx')
      .on(table.archivedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
    deletedAtPartialIdx: index('doc_deleted_at_partial_idx')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
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
    id: text('id').primaryKey(),
    knowledgeBaseId: text('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),
    tagSlot: text('tag_slot', {
      enum: TAG_SLOTS,
    }).notNull(),
    displayName: text('display_name').notNull(),
    fieldType: text('field_type').notNull().default('text'), // 'text', future: 'date', 'number', 'range'
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
    id: text('id').primaryKey(),
    knowledgeBaseId: text('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),

    // Chunk information
    chunkIndex: integer('chunk_index').notNull(),
    chunkHash: text('chunk_hash').notNull(),
    content: text('content').notNull(),
    contentLength: integer('content_length').notNull(),
    tokenCount: integer('token_count').notNull(),

    // Vector embeddings - optimized for text-embedding-3-small with HNSW support
    embedding: vector('embedding', { dimensions: 1536 }), // For text-embedding-3-small
    embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),

    // Chunk boundaries and overlap
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),

    // Tag columns inherited from document for efficient filtering
    // Text tags (7 slots)
    tag1: text('tag1'),
    tag2: text('tag2'),
    tag3: text('tag3'),
    tag4: text('tag4'),
    tag5: text('tag5'),
    tag6: text('tag6'),
    tag7: text('tag7'),
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
    boolean1: boolean('boolean1'),
    boolean2: boolean('boolean2'),
    boolean3: boolean('boolean3'),

    // Chunk state - enable/disable from knowledge base
    enabled: boolean('enabled').notNull().default(true),

    // Full-text search support - generated tsvector column
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${embedding.content})`
    ),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
    embeddingVectorHnswIdx: index('embedding_vector_hnsw_idx')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .with({
        m: 16,
        ef_construction: 64,
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
    contentFtsIdx: index('emb_content_fts_idx').using('gin', table.contentTsv),

    // Ensure embedding exists (simplified since we only support one model)
    embeddingNotNullCheck: check('embedding_not_null_check', sql`"embedding" IS NOT NULL`),
  })
)

export const docsEmbeddings = pgTable(
  'docs_embeddings',
  {
    chunkId: uuid('chunk_id').primaryKey().defaultRandom(),
    chunkText: text('chunk_text').notNull(),
    sourceDocument: text('source_document').notNull(),
    sourceLink: text('source_link').notNull(),
    headerText: text('header_text').notNull(),
    headerLevel: integer('header_level').notNull(),
    tokenCount: integer('token_count').notNull(),

    // Vector embedding - optimized for text-embedding-3-small with HNSW support
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),

    // Metadata for flexible filtering
    metadata: jsonb('metadata').notNull().default('{}'),

    // Full-text search support - generated tsvector column
    chunkTextTsv: tsvector('chunk_text_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${docsEmbeddings.chunkText})`
    ),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Source document queries
    sourceDocumentIdx: index('docs_emb_source_document_idx').on(table.sourceDocument),

    // Header level filtering
    headerLevelIdx: index('docs_emb_header_level_idx').on(table.headerLevel),

    // Combined source and header queries
    sourceHeaderIdx: index('docs_emb_source_header_idx').on(
      table.sourceDocument,
      table.headerLevel
    ),

    // Model-specific queries
    modelIdx: index('docs_emb_model_idx').on(table.embeddingModel),

    // Timestamp queries
    createdAtIdx: index('docs_emb_created_at_idx').on(table.createdAt),

    // Vector similarity search indexes (HNSW) - optimized for documentation embeddings
    embeddingVectorHnswIdx: index('docs_embedding_vector_hnsw_idx')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .with({
        m: 16,
        ef_construction: 64,
      }),

    // GIN index for JSONB metadata queries
    metadataGinIdx: index('docs_emb_metadata_gin_idx').using('gin', table.metadata),

    // Full-text search index
    chunkTextFtsIdx: index('docs_emb_chunk_text_fts_idx').using('gin', table.chunkTextTsv),

    // Constraints
    embeddingNotNullCheck: check('docs_embedding_not_null_check', sql`"embedding" IS NOT NULL`),
    headerLevelCheck: check(
      'docs_header_level_check',
      sql`"header_level" >= 1 AND "header_level" <= 6`
    ),
  })
)

export const chatTypeEnum = pgEnum('chat_type', ['mothership', 'copilot'])

export const copilotChats = pgTable(
  'copilot_chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    type: chatTypeEnum('type').notNull().default('copilot'),
    title: text('title'),
    model: text('model').notNull().default('claude-3-7-sonnet-latest'),
    conversationId: text('conversation_id'),
    previewYaml: text('preview_yaml'),
    planArtifact: text('plan_artifact'),
    config: jsonb('config'),
    resources: jsonb('resources').notNull().default('[]'),
    lastSeenAt: timestamp('last_seen_at'),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('copilot_chats_user_id_idx').on(table.userId),
    workflowIdIdx: index('copilot_chats_workflow_id_idx').on(table.workflowId),
    userWorkflowIdx: index('copilot_chats_user_workflow_idx').on(table.userId, table.workflowId),

    // Workspace access pattern
    userWorkspaceIdx2: index('copilot_chats_user_workspace_idx').on(
      table.userId,
      table.workspaceId
    ),

    // Ordering indexes
    createdAtIdx: index('copilot_chats_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('copilot_chats_updated_at_idx').on(table.updatedAt),
    workspaceCreatedAtIdIdx: index('copilot_chats_workspace_created_at_id_idx').on(
      table.workspaceId,
      sql`date_trunc('milliseconds', ${table.createdAt})`,
      table.id
    ),
  })
)

export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotChats.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    role: text('role').notNull(),
    content: jsonb('content').notNull(),
    streamId: text('stream_id'),
    parentMessageId: text('parent_message_id'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    seq: integer('seq'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    chatMessageUnique: uniqueIndex('copilot_messages_chat_message_unique').on(
      table.chatId,
      table.messageId
    ),
    chatCreatedAtIdx: index('copilot_messages_chat_created_at_idx')
      .on(table.chatId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    chatSeqIdx: index('copilot_messages_chat_seq_idx')
      .on(table.chatId, table.seq)
      .where(sql`${table.deletedAt} IS NULL`),
    chatStreamIdx: index('copilot_messages_chat_stream_idx')
      .on(table.chatId, table.streamId)
      .where(sql`${table.streamId} IS NOT NULL`),
    userCreatedAtIdx: index('copilot_messages_user_created_at_idx')
      .on(table.createdAt, table.chatId, table.messageId)
      .where(sql`${table.role} = 'user' AND ${table.deletedAt} IS NULL`),
  })
)

export const copilotWorkflowReadHashes = pgTable(
  'copilot_workflow_read_hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotChats.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    chatIdIdx: index('copilot_workflow_read_hashes_chat_id_idx').on(table.chatId),
    workflowIdIdx: index('copilot_workflow_read_hashes_workflow_id_idx').on(table.workflowId),
    chatWorkflowUnique: uniqueIndex('copilot_workflow_read_hashes_chat_workflow_unique').on(
      table.chatId,
      table.workflowId
    ),
  })
)

export const workflowCheckpoints = pgTable(
  'workflow_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotChats.id, { onDelete: 'cascade' }),
    messageId: text('message_id'), // ID of the user message that triggered this checkpoint
    workflowState: json('workflow_state').notNull(), // JSON workflow state
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('workflow_checkpoints_user_id_idx').on(table.userId),
    workflowIdIdx: index('workflow_checkpoints_workflow_id_idx').on(table.workflowId),
    chatIdIdx: index('workflow_checkpoints_chat_id_idx').on(table.chatId),
    messageIdIdx: index('workflow_checkpoints_message_id_idx').on(table.messageId),

    // Combined indexes for common queries
    userWorkflowIdx: index('workflow_checkpoints_user_workflow_idx').on(
      table.userId,
      table.workflowId
    ),
    workflowChatIdx: index('workflow_checkpoints_workflow_chat_idx').on(
      table.workflowId,
      table.chatId
    ),

    // Ordering indexes
    createdAtIdx: index('workflow_checkpoints_created_at_idx').on(table.createdAt),
    chatCreatedAtIdx: index('workflow_checkpoints_chat_created_at_idx').on(
      table.chatId,
      table.createdAt
    ),
  })
)

export const copilotRunStatusEnum = pgEnum('copilot_run_status', [
  'active',
  'paused_waiting_for_tool',
  'resuming',
  'complete',
  'error',
  'cancelled',
])

export const copilotAsyncToolStatusEnum = pgEnum('copilot_async_tool_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'delivered',
])

export type CopilotRunStatus = (typeof copilotRunStatusEnum.enumValues)[number]
export type CopilotAsyncToolStatus = (typeof copilotAsyncToolStatusEnum.enumValues)[number]

export const copilotRuns = pgTable(
  'copilot_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: text('execution_id').notNull(),
    parentRunId: uuid('parent_run_id'),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotChats.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    streamId: text('stream_id').notNull(),
    agent: text('agent'),
    model: text('model'),
    provider: text('provider'),
    status: copilotRunStatusEnum('status').notNull().default('active'),
    requestContext: jsonb('request_context').notNull().default('{}'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    error: text('error'),
  },
  (table) => ({
    executionIdIdx: index('copilot_runs_execution_id_idx').on(table.executionId),
    parentRunIdIdx: index('copilot_runs_parent_run_id_idx').on(table.parentRunId),
    chatIdIdx: index('copilot_runs_chat_id_idx').on(table.chatId),
    userIdIdx: index('copilot_runs_user_id_idx').on(table.userId),
    workflowIdIdx: index('copilot_runs_workflow_id_idx').on(table.workflowId),
    workspaceIdIdx: index('copilot_runs_workspace_id_idx').on(table.workspaceId),
    statusIdx: index('copilot_runs_status_idx').on(table.status),
    chatExecutionIdx: index('copilot_runs_chat_execution_idx').on(table.chatId, table.executionId),
    executionStartedAtIdx: index('copilot_runs_execution_started_at_idx').on(
      table.executionId,
      table.startedAt
    ),
    workspaceCompletedAtIdIdx: index('copilot_runs_workspace_completed_at_id_idx').on(
      table.workspaceId,
      sql`date_trunc('milliseconds', ${table.completedAt})`,
      table.id
    ),
    streamIdUnique: uniqueIndex('copilot_runs_stream_id_unique').on(table.streamId),
  })
)

export const copilotRunCheckpoints = pgTable(
  'copilot_run_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => copilotRuns.id, { onDelete: 'cascade' }),
    pendingToolCallId: text('pending_tool_call_id').notNull(),
    conversationSnapshot: jsonb('conversation_snapshot').notNull().default('{}'),
    agentState: jsonb('agent_state').notNull().default('{}'),
    providerRequest: jsonb('provider_request').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    runIdIdx: index('copilot_run_checkpoints_run_id_idx').on(table.runId),
    pendingToolCallIdIdx: index('copilot_run_checkpoints_pending_tool_call_id_idx').on(
      table.pendingToolCallId
    ),
    runPendingUnique: uniqueIndex('copilot_run_checkpoints_run_pending_tool_unique').on(
      table.runId,
      table.pendingToolCallId
    ),
  })
)

export const copilotAsyncToolCalls = pgTable(
  'copilot_async_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => copilotRuns.id, { onDelete: 'cascade' }),
    checkpointId: uuid('checkpoint_id').references(() => copilotRunCheckpoints.id, {
      onDelete: 'cascade',
    }),
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').notNull().default('{}'),
    status: copilotAsyncToolStatusEnum('status').notNull().default('pending'),
    result: jsonb('result'),
    error: text('error'),
    claimedAt: timestamp('claimed_at'),
    claimedBy: text('claimed_by'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    runIdIdx: index('copilot_async_tool_calls_run_id_idx').on(table.runId),
    checkpointIdIdx: index('copilot_async_tool_calls_checkpoint_id_idx').on(table.checkpointId),
    toolCallIdIdx: index('copilot_async_tool_calls_tool_call_id_idx').on(table.toolCallId),
    statusIdx: index('copilot_async_tool_calls_status_idx').on(table.status),
    runStatusIdx: index('copilot_async_tool_calls_run_status_idx').on(table.runId, table.status),
    toolCallUnique: uniqueIndex('copilot_async_tool_calls_tool_call_id_unique').on(
      table.toolCallId
    ),
  })
)

export const copilotFeedback = pgTable(
  'copilot_feedback',
  {
    feedbackId: uuid('feedback_id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotChats.id, { onDelete: 'cascade' }),
    userQuery: text('user_query').notNull(),
    agentResponse: text('agent_response').notNull(),
    isPositive: boolean('is_positive').notNull(),
    feedback: text('feedback'), // Optional feedback text
    workflowYaml: text('workflow_yaml'), // Optional workflow YAML if edit/build workflow was triggered
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Access patterns
    userIdIdx: index('copilot_feedback_user_id_idx').on(table.userId),
    chatIdIdx: index('copilot_feedback_chat_id_idx').on(table.chatId),
    userChatIdx: index('copilot_feedback_user_chat_idx').on(table.userId, table.chatId),

    // Query patterns
    isPositiveIdx: index('copilot_feedback_is_positive_idx').on(table.isPositive),

    // Ordering indexes
    createdAtIdx: index('copilot_feedback_created_at_idx').on(table.createdAt),
  })
)

// Tracks immutable deployment versions for each workflow
export const workflowDeploymentVersion = pgTable(
  'workflow_deployment_version',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name'),
    description: text('description'),
    state: json('state').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => ({
    workflowVersionUnique: uniqueIndex('workflow_deployment_version_workflow_version_unique').on(
      table.workflowId,
      table.version
    ),
    workflowActiveIdx: index('workflow_deployment_version_workflow_active_idx').on(
      table.workflowId,
      table.isActive
    ),
    createdAtIdx: index('workflow_deployment_version_created_at_idx').on(table.createdAt),
  })
)

/**
 * Tracks mutable deployment attempts separately from immutable version snapshots.
 */
export const workflowDeploymentOperation = pgTable(
  'workflow_deployment_operation',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    deploymentVersionId: text('deployment_version_id')
      .notNull()
      .references(() => workflowDeploymentVersion.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    previousActiveVersionId: text('previous_active_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'set null' }
    ),
    action: text('action').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    generation: integer('generation').notNull(),
    status: text('status').notNull().default('preparing'),
    componentReadiness: jsonb('component_readiness')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash').notNull(),
    actorId: text('actor_id').notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowGenerationUnique: uniqueIndex(
      'workflow_deployment_operation_workflow_generation_unique'
    ).on(table.workflowId, table.generation),
    workflowIdempotencyUnique: uniqueIndex(
      'workflow_deployment_operation_workflow_idempotency_unique'
    )
      .on(table.workflowId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    workflowInFlightUnique: uniqueIndex('workflow_deployment_operation_workflow_in_flight_unique')
      .on(table.workflowId)
      .where(sql`${table.status} IN ('preparing', 'activating')`),
    workflowStatusIdx: index('workflow_deployment_operation_workflow_status_idx').on(
      table.workflowId,
      table.status
    ),
    deploymentVersionIdx: index('workflow_deployment_operation_deployment_version_idx').on(
      table.deploymentVersionId
    ),
    workflowVersionGenerationIdx: index(
      'workflow_deployment_operation_workflow_version_generation_idx'
    ).on(table.workflowId, table.deploymentVersionId, table.generation.desc()),
    actionCheck: check(
      'workflow_deployment_operation_action_check',
      sql`${table.action} IN ('deploy', 'activate')`
    ),
    statusCheck: check(
      'workflow_deployment_operation_status_check',
      sql`${table.status} IN ('preparing', 'activating', 'active', 'failed', 'superseded')`
    ),
    generationCheck: check(
      'workflow_deployment_operation_generation_check',
      sql`${table.generation} > 0`
    ),
    protocolVersionCheck: check(
      'workflow_deployment_operation_protocol_version_check',
      sql`${table.protocolVersion} > 0`
    ),
  })
)

// Idempotency keys for preventing duplicate processing across all webhooks and triggers
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: text('key').primaryKey(),
    result: json('result').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Index for cleanup operations by creation time
    createdAtIdx: index('idempotency_key_created_at_idx').on(table.createdAt),
  })
)

export const outboxEvent = pgTable(
  'outbox_event',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    payload: json('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(10),
    availableAt: timestamp('available_at').notNull().defaultNow(),
    lockedAt: timestamp('locked_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  (table) => ({
    statusAvailableIdx: index('outbox_event_status_available_idx').on(
      table.status,
      table.availableAt
    ),
    lockedAtIdx: index('outbox_event_locked_at_idx').on(table.lockedAt),
    eventTypeCreatedIdx: index('outbox_event_type_created_idx').on(
      table.eventType,
      table.createdAt
    ),
  })
)

export const managedAgentConnection = pgTable(
  'managed_agent_connection',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /**
     * Anthropic workspace API key (a `sk-ant-*` value) encrypted with the
     * shared `encryptSecret` helper. Never returned to the client — list
     * endpoints return a masked preview only, and the tool decrypts
     * server-side per invocation.
     */
    encryptedApiKey: text('encrypted_api_key').notNull(),
    /** Timestamp of the last successful `GET /v1/agents` probe. */
    lastVerifiedAt: timestamp('last_verified_at'),
    /** Truncated error text from the most recent failed verify, if any. */
    lastVerificationError: text('last_verification_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('managed_agent_connection_workspace_id_idx').on(table.workspaceId),
    workspaceNameUnique: uniqueIndex('managed_agent_connection_workspace_name_unique').on(
      table.workspaceId,
      table.name
    ),
  })
)

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Track who created the server, but workspace owns it
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    description: text('description'),

    transport: text('transport').notNull(),
    url: text('url'),

    authType: text('auth_type').notNull().default('headers'),
    /**
     * Optional pre-registered OAuth credentials for servers that don't
     * support Dynamic Client Registration (RFC 7591). When set, these
     * shortcut the SDK's DCR step. `oauthClientSecret` is encrypted.
     */
    oauthClientId: text('oauth_client_id'),
    oauthClientSecret: text('oauth_client_secret'),
    headers: json('headers').default('{}'),
    timeout: integer('timeout').default(30000),
    retries: integer('retries').default(3),

    enabled: boolean('enabled').notNull().default(true),
    lastConnected: timestamp('last_connected'),
    connectionStatus: text('connection_status').default('disconnected'),
    lastError: text('last_error'),

    statusConfig: jsonb('status_config').default('{}'),

    toolCount: integer('tool_count').default(0),
    lastToolsRefresh: timestamp('last_tools_refresh'),
    totalRequests: integer('total_requests').default(0),
    lastUsed: timestamp('last_used'),

    deletedAt: timestamp('deleted_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern - active servers by workspace
    workspaceEnabledIdx: index('mcp_servers_workspace_enabled_idx').on(
      table.workspaceId,
      table.enabled
    ),

    // Soft delete pattern - workspace + not deleted (partial: only deleted rows)
    workspaceDeletedIdx: index('mcp_servers_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
)

/**
 * Workspace-scoped OAuth state for an outbound MCP server.
 *
 * Holds the SDK-managed OAuth artifacts needed to drive the standard MCP
 * OAuth 2.1 + PKCE + dynamic-client-registration flow against a remote MCP
 * server. One row per MCP server; workspace members share the authorized
 * connection just like they share the MCP server definition.
 */
export const mcpServerOauth = pgTable(
  'mcp_server_oauth',
  {
    id: text('id').primaryKey(),
    mcpServerId: text('mcp_server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    /** Last workspace user who initiated/completed authorization. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    /**
     * Encrypted JSON of the RFC 7591 dynamic client registration result.
     * Encrypted because some authorization servers may issue a client_secret
     * even for clients advertising `token_endpoint_auth_method: 'none'`.
     */
    clientInformation: text('client_information'),

    /** Encrypted JSON of the OAuth tokens (access + refresh). */
    tokens: text('tokens'),

    /** PKCE verifier held only between /authorize and /callback. */
    codeVerifier: text('code_verifier'),

    /** Opaque state mint to correlate the callback. */
    state: text('state'),

    /**
     * When `state` was minted. Used to expire the active-flow window and the
     * state replay window independently of `updatedAt`, which is touched by
     * token refreshes and other writes.
     */
    stateCreatedAt: timestamp('state_created_at'),

    lastRefreshedAt: timestamp('last_refreshed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    serverUnique: uniqueIndex('mcp_server_oauth_server_unique').on(table.mcpServerId),
    stateIdx: index('mcp_server_oauth_state_idx').on(table.state),
  })
)

// SSO Provider table
export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    domain: text('domain').notNull(),
    oidcConfig: text('oidc_config'),
    samlConfig: text('saml_config'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => ({
    providerIdIdx: index('sso_provider_provider_id_idx').on(table.providerId),
    domainIdx: index('sso_provider_domain_idx').on(table.domain),
    userIdIdx: index('sso_provider_user_id_idx').on(table.userId),
    organizationIdIdx: index('sso_provider_organization_id_idx').on(table.organizationId),
  })
)

/**
 * Workflow MCP Servers - User-created MCP servers that expose workflows as tools.
 * These servers are accessible by external MCP clients via API key authentication,
 * or publicly if isPublic is set to true.
 */
export const workflowMcpServer = pgTable(
  'workflow_mcp_server',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('workflow_mcp_server_workspace_id_idx').on(table.workspaceId),
    createdByIdx: index('workflow_mcp_server_created_by_idx').on(table.createdBy),
    deletedAtIdx: index('workflow_mcp_server_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('workflow_mcp_server_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
)

/**
 * Workflow MCP Tools - Workflows registered as tools within a Workflow MCP Server.
 * Each tool maps to a deployed workflow's execute endpoint.
 */
export const workflowMcpTool = pgTable(
  'workflow_mcp_tool',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => workflowMcpServer.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    toolDescription: text('tool_description'),
    parameterSchema: json('parameter_schema').notNull().default('{}'),
    parameterDescriptionOverrides: json('parameter_description_overrides')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::json`),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    serverIdIdx: index('workflow_mcp_tool_server_id_idx').on(table.serverId),
    workflowIdIdx: index('workflow_mcp_tool_workflow_id_idx').on(table.workflowId),
    serverWorkflowUnique: uniqueIndex('workflow_mcp_tool_server_workflow_unique')
      .on(table.serverId, table.workflowId)
      .where(sql`${table.archivedAt} IS NULL`),
    archivedAtPartialIdx: index('workflow_mcp_tool_archived_at_partial_idx')
      .on(table.archivedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
  })
)

/**
 * Custom Blocks - a deployed workflow published as a reusable, org-wide block.
 * Scoped to an organization: available across every workspace in the org. Bound to
 * a source `workflowId` and always executes that workflow's latest deployment. Start
 * input fields are derived live (not snapshotted). `type` is the stable lowercase
 * block-type slug (`custom_block_<shortId>`) that flows into the block registry
 * overlay, the palette, and permission-group `allowedIntegrations` access control.
 */
export const customBlock = pgTable(
  'custom_block',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Uploaded icon image URL (workspace storage), or null for the default icon. */
    iconUrl: text('icon_url'),
    /**
     * Per-input authored overrides keyed by the source Start field's stable `id`:
     * `Array<{ id, placeholder?, required? }>`. Only the placeholder and required
     * flag are authored — the input field set and its name/type/description are
     * always derived live from the deployed Start (so they can never go stale); an
     * override whose field was removed is ignored. Absent/empty → no overrides;
     * every deployed Start input is still exposed.
     */
    inputs: json('inputs').$type<Array<{ id: string; placeholder?: string; required?: boolean }>>(),
    /**
     * Curated outputs exposed to consumers: `Array<{ blockId, path, name }>`. Each
     * maps a child-workflow block output (blockId + dot-path) to a friendly output
     * name on the block. Empty/absent → expose the child's whole `result`. Internal
     * plumbing (child workflow id, trace spans) is never exposed.
     */
    outputs: json('outputs').$type<Array<{ blockId: string; path: string; name: string }>>(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index('custom_block_organization_id_idx').on(table.organizationId),
    workflowIdIdx: index('custom_block_workflow_id_idx').on(table.workflowId),
    orgTypeUnique: uniqueIndex('custom_block_organization_type_unique').on(
      table.organizationId,
      table.type
    ),
  })
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    actorName: text('actor_name'),
    actorEmail: text('actor_email'),
    resourceName: text('resource_name'),
    description: text('description'),
    metadata: jsonb('metadata').default('{}'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceCreatedIdx: index('audit_log_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt
    ),
    workspaceCreatedIdIdx: index('audit_log_workspace_created_at_id_idx').on(
      table.workspaceId,
      sql`date_trunc('milliseconds', ${table.createdAt})`,
      table.id
    ),
    actorCreatedIdx: index('audit_log_actor_created_idx').on(table.actorId, table.createdAt),
    resourceIdx: index('audit_log_resource_idx').on(table.resourceType, table.resourceId),
    actionIdx: index('audit_log_action_idx').on(table.action),
  })
)

export const usageLogCategoryEnum = pgEnum('usage_log_category', ['model', 'fixed', 'tool'])
export const usageLogSourceEnum = pgEnum('usage_log_source', [
  'workflow',
  'wand',
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
  'knowledge-base',
  'voice-input',
  'enrichment',
])

export const usageLog = pgTable(
  'usage_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    category: usageLogCategoryEnum('category').notNull(),

    source: usageLogSourceEnum('source').notNull(),

    description: text('description').notNull(),

    metadata: jsonb('metadata'),

    cost: decimal('cost').notNull(),
    eventKey: text('event_key'),
    billingEntityType: billingEntityTypeEnum('billing_entity_type'),
    billingEntityId: text('billing_entity_id'),
    billingPeriodStart: timestamp('billing_period_start'),
    billingPeriodEnd: timestamp('billing_period_end'),

    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    executionId: text('execution_id'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userCreatedAtIdx: index('usage_log_user_created_at_idx').on(table.userId, table.createdAt),
    sourceIdx: index('usage_log_source_idx').on(table.source),
    workspaceIdIdx: index('usage_log_workspace_id_idx').on(table.workspaceId),
    workflowIdIdx: index('usage_log_workflow_id_idx').on(table.workflowId),
    eventKeyUnique: uniqueIndex('usage_log_event_key_unique')
      .on(table.eventKey)
      .where(sql`${table.eventKey} IS NOT NULL`),
    billingEntityPeriodIdx: index('usage_log_billing_entity_period_idx')
      .on(
        table.billingEntityType,
        table.billingEntityId,
        table.billingPeriodStart,
        table.billingPeriodEnd
      )
      .where(sql`${table.billingEntityType} IS NOT NULL`),
    billingScopeAllOrNone: check(
      'usage_log_billing_scope_all_or_none',
      sql`(
        (${table.billingEntityType} IS NULL AND ${table.billingEntityId} IS NULL AND ${table.billingPeriodStart} IS NULL AND ${table.billingPeriodEnd} IS NULL)
        OR
        (${table.billingEntityType} IS NOT NULL AND ${table.billingEntityId} IS NOT NULL AND ${table.billingPeriodStart} IS NOT NULL AND ${table.billingPeriodEnd} IS NOT NULL AND ${table.billingPeriodStart} < ${table.billingPeriodEnd})
      )`
    ),
    workspaceCreatedAtIdx: index('usage_log_workspace_created_at_idx').on(
      table.workspaceId,
      table.createdAt
    ),
    executionIdIdx: index('usage_log_execution_id_idx').on(table.executionId),
  })
)

export const credentialTypeEnum = pgEnum('credential_type', [
  'oauth',
  'env_workspace',
  'env_personal',
  'service_account',
])

export const credential = pgTable(
  'credential',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    type: credentialTypeEnum('type').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    providerId: text('provider_id'),
    accountId: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
    envKey: text('env_key'),
    envOwnerUserId: text('env_owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    encryptedServiceAccountKey: text('encrypted_service_account_key'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('credential_workspace_id_idx').on(table.workspaceId),
    typeIdx: index('credential_type_idx').on(table.type),
    providerIdIdx: index('credential_provider_id_idx').on(table.providerId),
    accountIdIdx: index('credential_account_id_idx').on(table.accountId),
    envOwnerUserIdIdx: index('credential_env_owner_user_id_idx').on(table.envOwnerUserId),
    workspaceAccountUnique: uniqueIndex('credential_workspace_account_unique')
      .on(table.workspaceId, table.accountId)
      .where(sql`account_id IS NOT NULL`),
    workspaceEnvUnique: uniqueIndex('credential_workspace_env_unique')
      .on(table.workspaceId, table.type, table.envKey)
      .where(sql`type = 'env_workspace'`),
    workspacePersonalEnvUnique: uniqueIndex('credential_workspace_personal_env_unique')
      .on(table.workspaceId, table.type, table.envKey, table.envOwnerUserId)
      .where(sql`type = 'env_personal'`),
    oauthSourceConstraint: check(
      'credential_oauth_source_check',
      sql`(type <> 'oauth') OR (account_id IS NOT NULL AND provider_id IS NOT NULL)`
    ),
    workspaceEnvSourceConstraint: check(
      'credential_workspace_env_source_check',
      sql`(type <> 'env_workspace') OR (env_key IS NOT NULL AND env_owner_user_id IS NULL)`
    ),
    personalEnvSourceConstraint: check(
      'credential_personal_env_source_check',
      sql`(type <> 'env_personal') OR (env_key IS NOT NULL AND env_owner_user_id IS NOT NULL)`
    ),
  })
)

export const credentialMemberRoleEnum = pgEnum('credential_member_role', ['admin', 'member'])
export const credentialMemberStatusEnum = pgEnum('credential_member_status', [
  'active',
  'pending',
  'revoked',
])

export const credentialMember = pgTable(
  'credential_member',
  {
    id: text('id').primaryKey(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => credential.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: credentialMemberRoleEnum('role').notNull().default('member'),
    status: credentialMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at'),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('credential_member_user_id_idx').on(table.userId),
    roleIdx: index('credential_member_role_idx').on(table.role),
    statusIdx: index('credential_member_status_idx').on(table.status),
    uniqueMembership: uniqueIndex('credential_member_unique').on(table.credentialId, table.userId),
  })
)

export const pendingCredentialDraft = pgTable(
  'pending_credential_draft',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    credentialId: text('credential_id').references(() => credential.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    uniqueDraft: uniqueIndex('pending_draft_user_provider_ws').on(
      table.userId,
      table.providerId,
      table.workspaceId
    ),
  })
)

/**
 * A named set of access-control restrictions (`config`) governing users within
 * an organization.
 *
 * Scope invariant: the organization's single default group (`isDefault`) is
 * org-wide and governs everyone not covered by another group. Every non-default
 * group targets specific workspaces (rows in `permission_group_workspace`), and a
 * non-default group with no rows governs nothing. Being org-wide is definitionally
 * `isDefault` — there is no separate flag. Enforced by the API contracts/routes.
 *
 * Member invariant: a non-default group with no `permission_group_member` rows
 * governs every member of its workspaces (including external members); adding
 * members narrows it to only those users. The default group ignores membership.
 */
export const permissionGroup = pgTable(
  'permission_group',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    config: jsonb('config').notNull().default('{}'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (table) => ({
    createdByIdx: index('permission_group_created_by_idx').on(table.createdBy),
    organizationNameUnique: uniqueIndex('permission_group_organization_name_unique').on(
      table.organizationId,
      table.name
    ),
    defaultGroupUnique: uniqueIndex('permission_group_organization_default_unique')
      .on(table.organizationId)
      .where(sql`is_default = true`),
  })
)

/**
 * Workspaces a non-default `permission_group` targets. Rows are absent for the
 * organization-wide default group; a non-default group with zero rows governs no
 * workspace.
 */
export const permissionGroupWorkspace = pgTable(
  'permission_group_workspace',
  {
    id: text('id').primaryKey(),
    permissionGroupId: text('permission_group_id')
      .notNull()
      .references(() => permissionGroup.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('permission_group_workspace_workspace_id_idx').on(table.workspaceId),
    groupWorkspaceUnique: uniqueIndex('permission_group_workspace_group_workspace_unique').on(
      table.permissionGroupId,
      table.workspaceId
    ),
  })
)

/**
 * Explicit members of a `permission_group`. Membership narrows a non-default
 * group to only these users; a non-default group with no rows here governs every
 * member of its workspaces (including external members). The default group
 * ignores these rows.
 */
export const permissionGroupMember = pgTable(
  'permission_group_member',
  {
    id: text('id').primaryKey(),
    permissionGroupId: text('permission_group_id')
      .notNull()
      .references(() => permissionGroup.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  },
  (table) => ({
    permissionGroupIdIdx: index('permission_group_member_group_id_idx').on(table.permissionGroupId),
    groupUserUnique: uniqueIndex('permission_group_member_group_user_unique').on(
      table.permissionGroupId,
      table.userId
    ),
    organizationUserIdx: index('permission_group_member_organization_user_idx').on(
      table.organizationId,
      table.userId
    ),
  })
)

/**
 * Async Jobs - Queue for background job processing (Redis/DB backends)
 * Used when trigger.dev is not available for async workflow executions
 */
export const asyncJobs = pgTable(
  'async_jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    runAt: timestamp('run_at'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    error: text('error'),
    output: jsonb('output'),
    metadata: jsonb('metadata').notNull().default('{}'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusStartedAtIdx: index('async_jobs_status_started_at_idx').on(table.status, table.startedAt),
    statusCompletedAtIdx: index('async_jobs_status_completed_at_idx').on(
      table.status,
      table.completedAt
    ),
    schedulePendingRunAtIdx: index('async_jobs_schedule_pending_run_at_idx')
      .on(table.runAt, table.createdAt, table.id)
      .where(sql`${table.type} = 'schedule-execution' AND ${table.status} = 'pending'`),
    scheduleProcessingStartedAtIdx: index('async_jobs_schedule_processing_started_at_idx')
      .on(table.startedAt, table.id)
      .where(sql`${table.type} = 'schedule-execution' AND ${table.status} = 'processing'`),
  })
)

/**
 * Knowledge Connector - persistent link to an external source (Confluence, Google Drive, etc.)
 * that syncs documents into a knowledge base.
 */
export const knowledgeConnector = pgTable(
  'knowledge_connector',
  {
    id: text('id').primaryKey(),
    knowledgeBaseId: text('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBase.id, { onDelete: 'cascade' }),
    connectorType: text('connector_type').notNull(),
    credentialId: text('credential_id'),
    encryptedApiKey: text('encrypted_api_key'),
    sourceConfig: json('source_config').notNull(),
    syncMode: text('sync_mode').notNull().default('full'),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(1440),
    status: text('status').notNull().default('active'),
    lastSyncAt: timestamp('last_sync_at'),
    lastSyncError: text('last_sync_error'),
    lastSyncDocCount: integer('last_sync_doc_count'),
    nextSyncAt: timestamp('next_sync_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    archivedAt: timestamp('archived_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    knowledgeBaseIdIdx: index('kc_knowledge_base_id_idx').on(table.knowledgeBaseId),
    statusNextSyncIdx: index('kc_status_next_sync_idx').on(table.status, table.nextSyncAt),
    archivedAtPartialIdx: index('kc_archived_at_partial_idx')
      .on(table.archivedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
    deletedAtPartialIdx: index('kc_deleted_at_partial_idx')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
)

/**
 * Knowledge Connector Sync Log - audit trail for connector sync operations.
 */
export const knowledgeConnectorSyncLog = pgTable(
  'knowledge_connector_sync_log',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => knowledgeConnector.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    docsAdded: integer('docs_added').notNull().default(0),
    docsUpdated: integer('docs_updated').notNull().default(0),
    docsDeleted: integer('docs_deleted').notNull().default(0),
    docsUnchanged: integer('docs_unchanged').notNull().default(0),
    docsFailed: integer('docs_failed').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => ({
    connectorIdIdx: index('kcsl_connector_id_idx').on(table.connectorId),
  })
)

/**
 * User-defined table definitions
 * Stores schema and metadata for custom tables created by users
 */
export const userTableDefinitions = pgTable(
  'user_table_definitions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * @remarks
     * Stores the table schema definition. Example: { columns: [{ name: string, type: string, required: boolean }] }
     */
    schema: jsonb('schema').notNull(),
    /**
     * @remarks
     * Stores UI-specific metadata separate from the data schema.
     * Example: { columnWidths: { name: 200, age: 100 } }
     */
    metadata: jsonb('metadata'),
    maxRows: integer('max_rows').notNull().default(10000),
    rowCount: integer('row_count').notNull().default(0),
    /**
     * @remarks
     * Monotonic counter bumped by a statement-level trigger on `user_table_rows`
     * (INSERT/UPDATE/DELETE). Keys the versioned table-snapshot cache so a stored
     * CSV under `v{rows_version}` is reused until the table mutates. Never written
     * from application code — the trigger is the only writer (bypass-proof).
     */
    rowsVersion: bigint('rows_version', { mode: 'number' }).notNull().default(0),
    archivedAt: timestamp('archived_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('user_table_def_workspace_id_idx').on(table.workspaceId),
    workspaceNameUnique: uniqueIndex('user_table_def_workspace_name_unique')
      .on(table.workspaceId, table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    archivedAtIdx: index('user_table_def_archived_at_idx').on(table.archivedAt),
    workspaceArchivedAtPartialIdx: index('user_table_def_workspace_archived_partial_idx')
      .on(table.workspaceId, table.archivedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
  })
)

/**
 * User-defined table rows
 * Stores actual row data as JSONB for flexible schema
 */
export const userTableRows = pgTable(
  'user_table_rows',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => userTableDefinitions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    data: jsonb('data').notNull(),
    position: integer('position').notNull().default(0),
    /**
     * Fractional order key (base-62 string) — the authoritative row order.
     * Nullable during the backfill window. Ordered with `id` as a deterministic
     * tiebreaker.
     *
     * Stored with `COLLATE "C"` (migration 0228) so Postgres compares it bytewise,
     * matching the fractional-indexing library's ASCII ordering. drizzle can't
     * express column collation, so the collation lives only in the migration.
     */
    orderKey: text('order_key'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => ({
    /**
     * Tenant-scoped containment index (requires the `btree_gin` extension,
     * created in migration 0232). A plain GIN on `data` matches `@>` candidates
     * across every tenant sharing this relation — a hot value in someone else's
     * table inflates everyone's scans (measured 1.07M candidates fetched for a
     * 33k-row match). Leading with `table_id` intersects inside the index, and
     * `jsonb_path_ops` indexes only containment paths: rare-equality probe
     * 326ms → 17ms, and the index is smaller than the one it replaces.
     */
    dataGinIdx: index('user_table_rows_tenant_data_gin_idx').using(
      'gin',
      table.tableId,
      sql`${table.data} jsonb_path_ops`
    ),
    workspaceTableIdx: index('user_table_rows_workspace_table_idx').on(
      table.workspaceId,
      table.tableId
    ),
    tablePositionIdx: index('user_table_rows_table_position_idx').on(table.tableId, table.position),
    tableOrderKeyIdx: index('user_table_rows_table_order_key_idx').on(
      table.tableId,
      table.orderKey,
      table.id
    ),
    /**
     * Keyset pagination by id within one table (the delete-job worker's page walk). Without it
     * the planner scans the global pkey in id order, filtering out every other table's rows —
     * O(all rows) per page.
     */
    tableIdIdIdx: index('user_table_rows_table_id_id_idx').on(table.tableId, table.id),
  })
)

/**
 * Background data-mutation jobs on a user table (CSV import, bulk filtered delete). One row per
 * job. A detached worker streams progress into `rows_processed` and flips `status` to a terminal
 * state; cancel flips `status` to `'canceled'` and the worker bails at its next ownership check.
 *
 * The partial-unique index on `table_id WHERE status = 'running'` is the concurrency gate: at most
 * one running job per table, so a second import, or an import + delete, can't write into the same
 * table at once. Distinct from `table_run_dispatches` — that fans workflow runs across rows via
 * trigger.dev; this mutates row data directly.
 */
export const tableJobs = pgTable(
  'table_jobs',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => userTableDefinitions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** `'import'` | `'delete'`. */
    type: text('type').notNull(),
    /** `'running'` → `'ready'` | `'failed'` | `'canceled'`. */
    status: text('status').notNull().default('running'),
    /** Type-specific descriptor (e.g. delete filter/exclusions). Nullable; reserved for future
     *  resumability — today's workers carry their payload in-process via `runDetached`. */
    payload: jsonb('payload'),
    rowsProcessed: integer('rows_processed').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    /** One running write-job (import/delete/backfill) per table. Exports are read-only and
     *  excluded, so they can run alongside any other job. */
    oneActivePerTable: uniqueIndex('table_jobs_one_active_per_table')
      .on(table.tableId)
      .where(sql`${table.status} = 'running' AND ${table.type} <> 'export'`),
    watchdogIdx: index('table_jobs_watchdog_idx').on(table.status, table.updatedAt),
    tableStartedIdx: index('table_jobs_table_started_idx').on(table.tableId, table.startedAt),
  })
)

/**
 * Per-row workflow-group execution state. One row per (rowId, groupId) — the
 * group's run metadata (status, executionId, jobId, blockErrors, etc.) for
 * one row of one user-defined table.
 *
 * Lives in a sidecar table (not a JSONB column on `user_table_rows`) so the
 * dispatcher and "X running" counter can hit `(table_id, status)` and
 * `(table_id, group_id)` indexes directly instead of walking JSONB blobs, and
 * so each cell-write rewrites only its own row instead of the whole
 * executions object on the parent row tuple.
 */
export const tableRowExecutions = pgTable(
  'table_row_executions',
  {
    tableId: text('table_id')
      .notNull()
      .references(() => userTableDefinitions.id, { onDelete: 'cascade' }),
    rowId: text('row_id')
      .notNull()
      .references(() => userTableRows.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    status: text('status').notNull(),
    executionId: text('execution_id'),
    jobId: text('job_id'),
    workflowId: text('workflow_id').notNull(),
    error: text('error'),
    runningBlockIds: text('running_block_ids').array().notNull().default(sql`'{}'::text[]`),
    blockErrors: jsonb('block_errors').notNull().default({}),
    cancelledAt: timestamp('cancelled_at'),
    /**
     * Enrichment cascade breakdown (provider outcomes, cost, timing) for
     * `enrichment`-type groups. Null for workflow groups and pre-feature runs.
     * Deliberately excluded from the hot grid read (`loadExecutionsByRow`) — read
     * on demand for the enrichment details panel.
     */
    enrichmentDetails: jsonb('enrichment_details'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.rowId, table.groupId] }),
    tableStatusInFlightIdx: index('table_row_executions_table_status_idx')
      .on(table.tableId, table.status)
      .where(sql`${table.status} IN ('queued', 'running', 'pending')`),
    executionIdIdx: index('table_row_executions_execution_id_idx')
      .on(table.executionId)
      .where(sql`${table.executionId} IS NOT NULL`),
    tableGroupIdx: index('table_row_executions_table_group_idx').on(table.tableId, table.groupId),
  })
)

/**
 * One row per "Run column / Run row / Run all rows" gesture on a user table.
 * The dispatcher task walks the table in row-position windows, advancing
 * `cursor` as it enqueues cells into trigger.dev. Cancel flips `status` to
 * `'cancelled'` in one write; the dispatcher bails at the next iteration and
 * a bulk-SQL cell-cancel sweep neuters anything still in trigger.dev's queue
 * (workers no-op on pickup via the cancel-sticky guard).
 */
export const tableRunDispatches = pgTable(
  'table_run_dispatches',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => userTableDefinitions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    /** `'all'` re-runs completed cells; `'incomplete'` skips them. */
    mode: text('mode').notNull(),
    /** `{ groupIds: string[], rowIds?: string[] }` — the run's scope. */
    scope: jsonb('scope').notNull(),
    /** `pending` → `dispatching` → `complete` | `cancelled`. */
    status: text('status').notNull().default('pending'),
    /** Highest `user_table_rows.position` we've already enqueued cells for. */
    cursor: integer('cursor').notNull().default(0),
    /** Optional cap on how much work the dispatch does before completing.
     *  `{ type: 'rows', max: number }` today; the discriminated shape lets
     *  future caps (cells, cost, duration) extend without a schema change.
     *  Null = unbounded (process every row in scope). */
    limit: jsonb('limit'),
    /** Units of `limit.type` already consumed (eligible rows dispatched, for
     *  `type: 'rows'`). Mutable counter the dispatcher advances per window so
     *  the budget survives across the checkpointed waits between windows. */
    processedCount: integer('processed_count').notNull().default(0),
    /** When true, eligibility bypasses `autoRun: false` skip and treats
     *  terminal states as re-runnable. Auto-fire paths (row inserts,
     *  CSV import, addWorkflowGroup) set this to false so the dispatch
     *  honors the autoRun toggle. */
    isManualRun: boolean('is_manual_run').notNull().default(true),
    /** User who triggered the run, for per-member usage attribution. Null for
     *  auto-fire (row insert/update, CSV import) with no human initiator —
     *  those fall back to the workspace billed account. */
    triggeredByUserId: text('triggered_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
  },
  (table) => ({
    activeIdx: index('table_run_dispatches_active_idx').on(table.tableId, table.status),
    watchdogIdx: index('table_run_dispatches_watchdog_idx').on(table.status, table.requestedAt),
  })
)

export const mothershipInboxAllowedSender = pgTable(
  'mothership_inbox_allowed_sender',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    label: text('label'),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    wsEmailIdx: uniqueIndex('inbox_sender_ws_email_idx').on(table.workspaceId, table.email),
  })
)

export const mothershipInboxTask = pgTable(
  'mothership_inbox_task',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name'),
    subject: text('subject').notNull(),
    bodyPreview: text('body_preview'),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    emailMessageId: text('email_message_id'),
    inReplyTo: text('in_reply_to'),
    responseMessageId: text('response_message_id'),
    agentmailMessageId: text('agentmail_message_id'),
    status: text('status').notNull().default('received'),
    chatId: uuid('chat_id').references(() => copilotChats.id, { onDelete: 'set null' }),
    triggerJobId: text('trigger_job_id'),
    resultSummary: text('result_summary'),
    errorMessage: text('error_message'),
    rejectionReason: text('rejection_reason'),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    ccRecipients: text('cc_recipients'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processingStartedAt: timestamp('processing_started_at'),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    wsCreatedAtIdx: index('inbox_task_ws_created_at_idx').on(table.workspaceId, table.createdAt),
    wsStatusIdx: index('inbox_task_ws_status_idx').on(table.workspaceId, table.status),
    responseMsgIdIdx: index('inbox_task_response_msg_id_idx').on(table.responseMessageId),
    emailMsgIdIdx: index('inbox_task_email_msg_id_idx').on(table.emailMessageId),
  })
)

export const mothershipInboxWebhook = pgTable('mothership_inbox_webhook', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .unique()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  webhookId: text('webhook_id').notNull(),
  secret: text('secret').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

/**
 * The application code that read/wrote this table (Academy) was removed in
 * the same PR that would have dropped it here — deferred to a follow-up PR
 * once that removal has actually shipped, per the expand/contract migration
 * safety check (`check:migrations`), since a same-deploy drop would break
 * any pod still running the old code during a rolling deploy.
 */
export const academyCertStatusEnum = pgEnum('academy_cert_status', ['active', 'revoked', 'expired'])

/** Partner certification records issued on course completion */
export const academyCertificate = pgTable(
  'academy_certificate',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** References the file-based course ID from lib/academy/content */
    courseId: text('course_id').notNull(),
    status: academyCertStatusEnum('status').notNull().default('active'),
    issuedAt: timestamp('issued_at').notNull().defaultNow(),
    /** Optional expiry for recertification requirements */
    expiresAt: timestamp('expires_at'),
    /** Human-readable unique certificate number, e.g. SIM-2026-00042 */
    certificateNumber: text('certificate_number').notNull().unique(),
    /** Snapshot of name and other metadata at time of issue */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('academy_certificate_user_id_idx').on(table.userId),
    courseIdIdx: index('academy_certificate_course_id_idx').on(table.courseId),
    userCourseUnique: uniqueIndex('academy_certificate_user_course_unique').on(
      table.userId,
      table.courseId
    ),
    certNumberIdx: index('academy_certificate_number_idx').on(table.certificateNumber),
    statusIdx: index('academy_certificate_status_idx').on(table.status),
  })
)

export const dataDrainSourceEnum = pgEnum('data_drain_source', [
  'workflow_logs',
  'job_logs',
  'audit_logs',
  'copilot_chats',
  'copilot_runs',
])

export type DataDrainSource = (typeof dataDrainSourceEnum.enumValues)[number]

export const dataDrainDestinationEnum = pgEnum('data_drain_destination', [
  's3',
  'gcs',
  'azure_blob',
  'datadog',
  'bigquery',
  'snowflake',
  'webhook',
])

export type DataDrainDestination = (typeof dataDrainDestinationEnum.enumValues)[number]

export const dataDrainCadenceEnum = pgEnum('data_drain_cadence', ['hourly', 'daily'])

export type DataDrainCadence = (typeof dataDrainCadenceEnum.enumValues)[number]

export const dataDrainRunStatusEnum = pgEnum('data_drain_run_status', [
  'running',
  'success',
  'failed',
])

export type DataDrainRunStatus = (typeof dataDrainRunStatusEnum.enumValues)[number]

export const dataDrainRunTriggerEnum = pgEnum('data_drain_run_trigger', ['cron', 'manual'])

export type DataDrainRunTrigger = (typeof dataDrainRunTriggerEnum.enumValues)[number]

export const dataDrains = pgTable(
  'data_drains',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    source: dataDrainSourceEnum('source').notNull(),
    destinationType: dataDrainDestinationEnum('destination_type').notNull(),
    /** Non-secret destination config (bucket, region, prefix, url, ...). Validated by destination registry. */
    destinationConfig: jsonb('destination_config').$type<Record<string, unknown>>().notNull(),
    /** Encrypted JSON blob containing destination credentials. Never returned to clients. */
    destinationCredentials: text('destination_credentials').notNull(),
    scheduleCadence: dataDrainCadenceEnum('schedule_cadence').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Opaque cursor — JSON-encoded, source-defined. Advances only on overall run success. */
    cursor: text('cursor'),
    lastRunAt: timestamp('last_run_at'),
    lastSuccessAt: timestamp('last_success_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('data_drains_org_idx').on(table.organizationId),
    dueIdx: index('data_drains_due_idx').on(table.enabled, table.lastRunAt),
    orgNameUnique: uniqueIndex('data_drains_org_name_unique').on(table.organizationId, table.name),
  })
)

export const dataDrainRuns = pgTable(
  'data_drain_runs',
  {
    id: text('id').primaryKey(),
    drainId: text('drain_id')
      .notNull()
      .references(() => dataDrains.id, { onDelete: 'cascade' }),
    status: dataDrainRunStatusEnum('status').notNull(),
    trigger: dataDrainRunTriggerEnum('trigger').notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    rowsExported: integer('rows_exported').notNull().default(0),
    bytesWritten: bigint('bytes_written', { mode: 'number' }).notNull().default(0),
    cursorBefore: text('cursor_before'),
    cursorAfter: text('cursor_after'),
    error: text('error'),
    /** Destination-specific delivery locators for this run (e.g. S3 keys, webhook response ids). */
    locators: jsonb('locators').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => ({
    drainStartedIdx: index('data_drain_runs_drain_started_idx').on(table.drainId, table.startedAt),
  })
)
