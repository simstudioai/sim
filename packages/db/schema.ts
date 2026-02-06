import { type SQL, sql } from 'drizzle-orm'
import {
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
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  isSuperUser: boolean('is_super_user').notNull().default(false),
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
    uniqueUserProvider: uniqueIndex('account_user_provider_unique').on(
      table.userId,
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
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => workflowFolder.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#3972F6'),
    lastSynced: timestamp('last_synced').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    isDeployed: boolean('is_deployed').notNull().default(false),
    deployedAt: timestamp('deployed_at'),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at'),
    variables: json('variables').default('{}'),
  },
  (table) => ({
    userIdIdx: index('workflow_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workflow_workspace_id_idx').on(table.workspaceId),
    userWorkspaceIdx: index('workflow_user_workspace_idx').on(table.userId, table.workspaceId),
    folderSortIdx: index('workflow_folder_sort_idx').on(table.folderId, table.sortOrder),
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

    executionData: jsonb('execution_data').notNull().default('{}'),
    cost: jsonb('cost'),
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
    status: text('status').notNull().default('paused'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    pausedAt: timestamp('paused_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One settings record per user

  // General settings
  theme: text('theme').notNull().default('dark'),
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

  // Notification preferences
  errorNotificationsEnabled: boolean('error_notifications_enabled').notNull().default(true),

  // Canvas preferences
  snapToGridSize: integer('snap_to_grid_size').notNull().default(0), // 0 = off, 10-50 = grid size
  showActionBar: boolean('show_action_bar').notNull().default(true),

  // Copilot preferences - maps model_id to enabled/disabled boolean
  copilotEnabledModels: jsonb('copilot_enabled_models').notNull().default('{}'),

  // Copilot auto-allowed integration tools - array of tool IDs that can run without confirmation
  copilotAutoAllowedTools: jsonb('copilot_auto_allowed_tools').notNull().default('[]'),

  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workflowSchedule = pgTable(
  'workflow_schedule',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    deploymentVersionId: text('deployment_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'cascade' }
    ),
    blockId: text('block_id'),
    cronExpression: text('cron_expression'),
    nextRunAt: timestamp('next_run_at'),
    lastRanAt: timestamp('last_ran_at'),
    lastQueuedAt: timestamp('last_queued_at'),
    triggerType: text('trigger_type').notNull(), // "manual", "webhook", "schedule"
    timezone: text('timezone').notNull().default('UTC'),
    failedCount: integer('failed_count').notNull().default(0), // Track consecutive failures
    status: text('status').notNull().default('active'), // 'active' or 'disabled'
    lastFailedAt: timestamp('last_failed_at'), // When the schedule last failed
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      workflowBlockUnique: uniqueIndex('workflow_schedule_workflow_block_deployment_unique').on(
        table.workflowId,
        table.blockId,
        table.deploymentVersionId
      ),
      workflowDeploymentIdx: index('workflow_schedule_workflow_deployment_idx').on(
        table.workflowId,
        table.deploymentVersionId
      ),
    }
  }
)

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
    blockId: text('block_id'),
    path: text('path').notNull(),
    provider: text('provider'), // e.g., "whatsapp", "github", etc.
    providerConfig: json('provider_config'), // Store provider-specific configuration
    isActive: boolean('is_active').notNull().default(true),
    failedCount: integer('failed_count').default(0), // Track consecutive failures
    lastFailedAt: timestamp('last_failed_at'), // When the webhook last failed
    credentialSetId: text('credential_set_id').references(() => credentialSet.id, {
      onDelete: 'set null',
    }), // For credential set webhooks - enables efficient queries
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure webhook paths are unique per deployment version
      pathIdx: uniqueIndex('path_deployment_unique').on(table.path, table.deploymentVersionId),
      // Optimize queries for webhooks by workflow and block
      workflowBlockIdx: index('idx_webhook_on_workflow_id_block_id').on(
        table.workflowId,
        table.blockId
      ),
      workflowDeploymentIdx: index('webhook_workflow_deployment_idx').on(
        table.workflowId,
        table.deploymentVersionId
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
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    notificationType: notificationTypeEnum('notification_type').notNull(),
    workflowIds: text('workflow_ids').array().notNull().default(sql`'{}'::text[]`),
    allWorkflows: boolean('all_workflows').notNull().default(false),
    levelFilter: text('level_filter')
      .array()
      .notNull()
      .default(sql`ARRAY['info', 'error']::text[]`),
    triggerFilter: text('trigger_filter')
      .array()
      .notNull()
      .default(sql`ARRAY['api', 'webhook', 'schedule', 'manual', 'chat']::text[]`),
    includeFinalOutput: boolean('include_final_output').notNull().default(false),
    includeTraceSpans: boolean('include_trace_spans').notNull().default(false),
    includeRateLimits: boolean('include_rate_limits').notNull().default(false),
    includeUsageData: boolean('include_usage_data').notNull().default(false),

    // Channel-specific configuration
    webhookConfig: jsonb('webhook_config'),
    emailRecipients: text('email_recipients').array(),
    slackConfig: jsonb('slack_config'),

    // Alert rule configuration (if null, sends on every execution)
    alertConfig: jsonb('alert_config'),
    lastAlertAt: timestamp('last_alert_at'),

    active: boolean('active').notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => workspaceNotificationSubscription.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    status: notificationDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextAttemptAt: timestamp('next_attempt_at'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }), // Only set for workspace keys
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
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
  })
)

export const billingBlockedReasonEnum = pgEnum('billing_blocked_reason', [
  'payment_failed',
  'dispute',
])

export const userStats = pgTable('user_stats', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One record per user
  totalManualExecutions: integer('total_manual_executions').notNull().default(0),
  totalApiCalls: integer('total_api_calls').notNull().default(0),
  totalWebhookTriggers: integer('total_webhook_triggers').notNull().default(0),
  totalScheduledExecutions: integer('total_scheduled_executions').notNull().default(0),
  totalChatExecutions: integer('total_chat_executions').notNull().default(0),
  totalMcpExecutions: integer('total_mcp_executions').notNull().default(0),
  totalA2aExecutions: integer('total_a2a_executions').notNull().default(0),
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  totalCost: decimal('total_cost').notNull().default('0'),
  currentUsageLimit: decimal('current_usage_limit').default(DEFAULT_FREE_CREDITS.toString()), // Default $20 for free plan, null for team/enterprise
  usageLimitUpdatedAt: timestamp('usage_limit_updated_at').defaultNow(),
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
  lastActive: timestamp('last_active').notNull().defaultNow(),
  billingBlocked: boolean('billing_blocked').notNull().default(false),
  billingBlockedReason: billingBlockedReasonEnum('billing_blocked_reason'),
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
    workspaceIdIdx: index('skill_workspace_id_idx').on(table.workspaceId),
    workspaceNameUnique: uniqueIndex('skill_workspace_name_unique').on(
      table.workspaceId,
      table.name
    ),
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
    seats: integer('seats'),
    trialStart: timestamp('trial_start'),
    trialEnd: timestamp('trial_end'),
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

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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

    // UI/UX Customizations
    // { primaryColor, welcomeMessage, thankYouTitle, thankYouMessage, logoUrl }
    customizations: json('customizations').default('{}'),

    // Authentication options (following chat pattern)
    authType: text('auth_type').notNull().default('public'), // 'public', 'password', 'email'
    password: text('password'), // Stored encrypted, populated when authType is 'password'
    allowedEmails: json('allowed_emails').default('[]'), // Array of allowed emails or domains

    // Branding
    showBranding: boolean('show_branding').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    identifierIdx: uniqueIndex('form_identifier_idx').on(table.identifier),
    workflowIdIdx: index('form_workflow_id_idx').on(table.workflowId),
    userIdIdx: index('form_user_id_idx').on(table.userId),
  })
)

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: json('metadata'),
  orgUsageLimit: decimal('org_usage_limit'),
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  departedMemberUsage: decimal('departed_member_usage').notNull().default('0'),
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

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('invitation_email_idx').on(table.email),
    organizationIdIdx: index('invitation_organization_id_idx').on(table.organizationId),
  })
)

export const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  billedAccountUserId: text('billed_account_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'no action' }),
  allowPersonalApiKeys: boolean('allow_personal_api_keys').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('workspace_file_workspace_id_idx').on(table.workspaceId),
    keyIdx: index('workspace_file_key_idx').on(table.key),
  })
)

export const workspaceFiles = pgTable(
  'workspace_files',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    context: text('context').notNull(), // 'workspace', 'copilot', 'chat', 'knowledge-base', 'profile-pictures', 'general', 'execution'
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => ({
    keyIdx: index('workspace_files_key_idx').on(table.key),
    userIdIdx: index('workspace_files_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workspace_files_workspace_id_idx').on(table.workspaceId),
    contextIdx: index('workspace_files_context_idx').on(table.context),
  })
)

export const permissionTypeEnum = pgEnum('permission_type', ['admin', 'write', 'read'])

export const workspaceInvitationStatusEnum = pgEnum('workspace_invitation_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
])

export type WorkspaceInvitationStatus = (typeof workspaceInvitationStatusEnum.enumValues)[number]

export const workspaceInvitation = pgTable('workspace_invitation', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  status: workspaceInvitationStatusEnum('status').notNull().default('pending'),
  token: text('token').notNull().unique(),
  permissions: permissionTypeEnum('permissions').notNull().default('admin'),
  orgInvitationId: text('org_invitation_id'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
    workspaceId: text('workspace_id').references(() => workspace.id),
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
    deletedAt: timestamp('deleted_at'), // Soft delete

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

export const copilotChats = pgTable(
  'copilot_chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    title: text('title'),
    messages: jsonb('messages').notNull().default('[]'),
    model: text('model').notNull().default('claude-3-7-sonnet-latest'),
    conversationId: text('conversation_id'),
    previewYaml: text('preview_yaml'), // YAML content for pending workflow preview
    planArtifact: text('plan_artifact'), // Plan/design document artifact for the chat
    config: jsonb('config'), // JSON config storing model and mode settings { model, mode }
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('copilot_chats_user_id_idx').on(table.userId),
    workflowIdIdx: index('copilot_chats_workflow_id_idx').on(table.workflowId),
    userWorkflowIdx: index('copilot_chats_user_workflow_idx').on(table.userId, table.workflowId),

    // Ordering indexes
    createdAtIdx: index('copilot_chats_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('copilot_chats_updated_at_idx').on(table.updatedAt),
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

export const templateStatusEnum = pgEnum('template_status', ['pending', 'approved', 'rejected'])
export const templateCreatorTypeEnum = pgEnum('template_creator_type', ['user', 'organization'])

export const templateCreators = pgTable(
  'template_creators',
  {
    id: text('id').primaryKey(),
    referenceType: templateCreatorTypeEnum('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    name: text('name').notNull(),
    profileImageUrl: text('profile_image_url'),
    details: jsonb('details'),
    verified: boolean('verified').notNull().default(false),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    referenceUniqueIdx: uniqueIndex('template_creators_reference_idx').on(
      table.referenceType,
      table.referenceId
    ),
    referenceIdIdx: index('template_creators_reference_id_idx').on(table.referenceId),
    createdByIdx: index('template_creators_created_by_idx').on(table.createdBy),
  })
)

export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    details: jsonb('details'),
    creatorId: text('creator_id').references(() => templateCreators.id, { onDelete: 'set null' }),
    views: integer('views').notNull().default(0),
    stars: integer('stars').notNull().default(0),
    status: templateStatusEnum('status').notNull().default('pending'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`), // Array of tags
    requiredCredentials: jsonb('required_credentials').notNull().default('[]'), // Array of credential requirements
    state: jsonb('state').notNull(), // Store the workflow state directly
    ogImageUrl: text('og_image_url'), // Pre-generated OpenGraph image URL
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    statusIdx: index('templates_status_idx').on(table.status),
    creatorIdIdx: index('templates_creator_id_idx').on(table.creatorId),

    // Sorting indexes for popular/trending templates
    viewsIdx: index('templates_views_idx').on(table.views),
    starsIdx: index('templates_stars_idx').on(table.stars),

    // Composite indexes for common queries
    statusViewsIdx: index('templates_status_views_idx').on(table.status, table.views),
    statusStarsIdx: index('templates_status_stars_idx').on(table.status, table.stars),

    // Temporal indexes
    createdAtIdx: index('templates_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('templates_updated_at_idx').on(table.updatedAt),
  })
)

export const templateStars = pgTable(
  'template_stars',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    starredAt: timestamp('starred_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('template_stars_user_id_idx').on(table.userId),
    templateIdIdx: index('template_stars_template_id_idx').on(table.templateId),

    // Composite indexes for common queries
    userTemplateIdx: index('template_stars_user_template_idx').on(table.userId, table.templateId),
    templateUserIdx: index('template_stars_template_user_idx').on(table.templateId, table.userId),

    // Temporal indexes for analytics
    starredAtIdx: index('template_stars_starred_at_idx').on(table.starredAt),
    templateStarredAtIdx: index('template_stars_template_starred_at_idx').on(
      table.templateId,
      table.starredAt
    ),

    // Uniqueness constraint - prevent duplicate stars
    uniqueUserTemplateConstraint: uniqueIndex('template_stars_user_template_unique').on(
      table.userId,
      table.templateId
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

    // Soft delete pattern - workspace + not deleted
    workspaceDeletedIdx: index('mcp_servers_workspace_deleted_idx').on(
      table.workspaceId,
      table.deletedAt
    ),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('workflow_mcp_server_workspace_id_idx').on(table.workspaceId),
    createdByIdx: index('workflow_mcp_server_created_by_idx').on(table.createdBy),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    serverIdIdx: index('workflow_mcp_tool_server_id_idx').on(table.serverId),
    workflowIdIdx: index('workflow_mcp_tool_workflow_id_idx').on(table.workflowId),
    serverWorkflowUnique: uniqueIndex('workflow_mcp_tool_server_workflow_unique').on(
      table.serverId,
      table.workflowId
    ),
  })
)

/**
 * A2A Task State Enum (v0.2.6)
 */
export const a2aTaskStatusEnum = pgEnum('a2a_task_status', [
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
  'auth-required',
  'unknown',
])

/**
 * A2A Agents - Workflows exposed as A2A-compatible agents
 * These agents can be called by external A2A clients
 */
export const a2aAgent = pgTable(
  'a2a_agent',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** Agent name (used in Agent Card) */
    name: text('name').notNull(),
    /** Agent description */
    description: text('description'),
    /** Agent version */
    version: text('version').notNull().default('1.0.0'),

    /** Agent capabilities (streaming, pushNotifications, etc.) */
    capabilities: jsonb('capabilities').notNull().default('{}'),
    /** Agent skills derived from workflow */
    skills: jsonb('skills').notNull().default('[]'),
    /** Authentication configuration */
    authentication: jsonb('authentication').notNull().default('{}'),
    /** Agent card signatures for verification (v0.3) */
    signatures: jsonb('signatures').default('[]'),

    /** Whether the agent is published and discoverable */
    isPublished: boolean('is_published').notNull().default(false),
    /** When the agent was published */
    publishedAt: timestamp('published_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('a2a_agent_workspace_id_idx').on(table.workspaceId),
    workflowIdIdx: index('a2a_agent_workflow_id_idx').on(table.workflowId),
    createdByIdx: index('a2a_agent_created_by_idx').on(table.createdBy),
    workspaceWorkflowUnique: uniqueIndex('a2a_agent_workspace_workflow_unique').on(
      table.workspaceId,
      table.workflowId
    ),
  })
)

/**
 * A2A Tasks - Tracks task state for A2A agent interactions (v0.3)
 * Each task represents a conversation/interaction with an agent
 */
export const a2aTask = pgTable(
  'a2a_task',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => a2aAgent.id, { onDelete: 'cascade' }),

    /** Context ID for multi-turn conversations (maps to API contextId) */
    sessionId: text('session_id'),

    /** Task state */
    status: a2aTaskStatusEnum('status').notNull().default('submitted'),

    /** Message history (maps to API history, array of TaskMessage) */
    messages: jsonb('messages').notNull().default('[]'),

    /** Structured output artifacts */
    artifacts: jsonb('artifacts').default('[]'),

    /** Link to workflow execution */
    executionId: text('execution_id'),

    /** Additional metadata */
    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    agentIdIdx: index('a2a_task_agent_id_idx').on(table.agentId),
    sessionIdIdx: index('a2a_task_session_id_idx').on(table.sessionId),
    statusIdx: index('a2a_task_status_idx').on(table.status),
    executionIdIdx: index('a2a_task_execution_id_idx').on(table.executionId),
    createdAtIdx: index('a2a_task_created_at_idx').on(table.createdAt),
  })
)

/**
 * A2A Push Notification Config - Webhook configuration for task updates
 * Stores push notification webhooks for async task updates
 */
export const a2aPushNotificationConfig = pgTable(
  'a2a_push_notification_config',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => a2aTask.id, { onDelete: 'cascade' }),

    /** Webhook URL for notifications */
    url: text('url').notNull(),

    /** Optional token for client-side validation */
    token: text('token'),

    /** Authentication schemes (e.g., ['bearer', 'apiKey']) */
    authSchemes: jsonb('auth_schemes').default('[]'),

    /** Authentication credentials hint */
    authCredentials: text('auth_credentials'),

    /** Whether this config is active */
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    taskIdIdx: index('a2a_push_notification_config_task_id_idx').on(table.taskId),
    taskIdUnique: uniqueIndex('a2a_push_notification_config_task_unique').on(table.taskId),
  })
)

export const usageLogCategoryEnum = pgEnum('usage_log_category', ['model', 'fixed'])
export const usageLogSourceEnum = pgEnum('usage_log_source', ['workflow', 'wand', 'copilot'])

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
  })
)

export const credentialSet = pgTable(
  'credential_set',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    providerId: text('provider_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index('credential_set_organization_id_idx').on(table.organizationId),
    createdByIdx: index('credential_set_created_by_idx').on(table.createdBy),
    orgNameUnique: uniqueIndex('credential_set_org_name_unique').on(
      table.organizationId,
      table.name
    ),
    providerIdIdx: index('credential_set_provider_id_idx').on(table.providerId),
  })
)

export const credentialSetMemberStatusEnum = pgEnum('credential_set_member_status', [
  'active',
  'pending',
  'revoked',
])

export const credentialSetMember = pgTable(
  'credential_set_member',
  {
    id: text('id').primaryKey(),
    credentialSetId: text('credential_set_id')
      .notNull()
      .references(() => credentialSet.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: credentialSetMemberStatusEnum('status').notNull().default('pending'),
    joinedAt: timestamp('joined_at'),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    credentialSetIdIdx: index('credential_set_member_set_id_idx').on(table.credentialSetId),
    userIdIdx: index('credential_set_member_user_id_idx').on(table.userId),
    uniqueMembership: uniqueIndex('credential_set_member_unique').on(
      table.credentialSetId,
      table.userId
    ),
    statusIdx: index('credential_set_member_status_idx').on(table.status),
  })
)

export const credentialSetInvitationStatusEnum = pgEnum('credential_set_invitation_status', [
  'pending',
  'accepted',
  'expired',
  'cancelled',
])

export const credentialSetInvitation = pgTable(
  'credential_set_invitation',
  {
    id: text('id').primaryKey(),
    credentialSetId: text('credential_set_id')
      .notNull()
      .references(() => credentialSet.id, { onDelete: 'cascade' }),
    email: text('email'),
    token: text('token').notNull().unique(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: credentialSetInvitationStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    acceptedByUserId: text('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    credentialSetIdIdx: index('credential_set_invitation_set_id_idx').on(table.credentialSetId),
    tokenIdx: index('credential_set_invitation_token_idx').on(table.token),
    statusIdx: index('credential_set_invitation_status_idx').on(table.status),
    expiresAtIdx: index('credential_set_invitation_expires_at_idx').on(table.expiresAt),
  })
)

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
    autoAddNewMembers: boolean('auto_add_new_members').notNull().default(false),
  },
  (table) => ({
    organizationIdIdx: index('permission_group_organization_id_idx').on(table.organizationId),
    createdByIdx: index('permission_group_created_by_idx').on(table.createdBy),
    orgNameUnique: uniqueIndex('permission_group_org_name_unique').on(
      table.organizationId,
      table.name
    ),
    autoAddNewMembersUnique: uniqueIndex('permission_group_org_auto_add_unique')
      .on(table.organizationId)
      .where(sql`auto_add_new_members = true`),
  })
)

export const permissionGroupMember = pgTable(
  'permission_group_member',
  {
    id: text('id').primaryKey(),
    permissionGroupId: text('permission_group_id')
      .notNull()
      .references(() => permissionGroup.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  },
  (table) => ({
    permissionGroupIdIdx: index('permission_group_member_group_id_idx').on(table.permissionGroupId),
    userIdUnique: uniqueIndex('permission_group_member_user_id_unique').on(table.userId),
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
  })
)
