import { omit } from '@sim/utils/object'
import { getTableColumns, type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  decimal,
  doublePrecision,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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

/** Raw binary column. Postgres `bytea` ↔ Node `Buffer` (the pg driver handles the encoding). */
export const bytea = customType<{
  data: Buffer
  driverData: Buffer
}>({
  dataType() {
    return 'bytea'
  },
})

/**
 * An email address reduced to the identity it names, in SQL. The one expression
 * every comparison of an address by identity must use — and the exact expression
 * `user_email_lower_idx` indexes, so a predicate written any other way silently
 * becomes a sequential scan. The TypeScript twin is `normalizeEmail` in
 * `@sim/utils/string`; the two must agree, and both are trim-and-lowercase.
 */
export function foldedEmail(column: AnyPgColumn | SQL): SQL<string> {
  return sql<string>`lower(btrim(${column}))`
}

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * Unique byte-for-byte only. The identity an address names is
     * `foldedEmail(email)`, which `user_email_lower_idx` indexes.
     */
    email: text('email').notNull().unique(),
    /**
     * Legacy signup normalization strips Gmail dots and tags and must never be
     * used for identity. Retained for Better Auth and full-row readers that
     * still select this column; removal needs a separate projection migration.
     */
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
    /**
     * When set, the account is suspended: sign-in is refused and API keys stop
     * authenticating, while every resource the user owns is left untouched.
     *
     * Deliberately not `banned`. A ban is a platform-admin action whose
     * `user.update.after` hook runs `disableUserResources`, archiving every
     * workspace the user owns and deleting their API keys, and Sim has no
     * server-side unban to reverse it. SCIM `active: false` is a reversible
     * organization-level suspension that must preserve ownership for a later
     * reactivation, so it needs a state of its own.
     */
    suspendedAt: timestamp('suspended_at'),
    /**
     * Who suspended the account. Only `scim` exists today; a source only ever
     * lifts its own suspension, so a later source cannot have its suspensions
     * undone by a directory sync.
     */
    suspensionSource: text('suspension_source'),
  },
  (table) => ({
    /**
     * The folded address, which is how every identity binding by email
     * compares — credential-group enrollments, the `u:` document access token,
     * the ambiguity check access resolution runs on every read. Without it
     * each of those is a sequential scan of `user`.
     *
     * Not unique. `email` is unique byte-for-byte only, and a small number of
     * historical accounts collide once folded; access resolution refuses to
     * bind an ambiguous address rather than let either account read the
     * other's documents. Follow-up, after those accounts are merged: promote to
     * UNIQUE so the state cannot arise at all.
     */
    emailLowerIdx: index('user_email_lower_idx').on(foldedEmail(table.email)),
  })
)

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
    oauthConfig: text('oauth_config'),
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

export const folderResourceTypeEnum = pgEnum('folder_resource_type', [
  'workflow',
  'file',
  'knowledge_base',
  'table',
])

/**
 * Generic folder hierarchy shared by workflows, files, knowledge bases, and tables.
 * Supersedes the resource-specific `workflow_folder` and `workspace_file_folders` tables,
 * dropped in migration 0276 once the cutover was verified against production.
 *
 * `resourceType` is a real `pgEnum` here — unlike `pinnedItem.resourceType` — because the
 * set of folder-bearing resources is small and fixed. A folder may only parent a folder
 * of the same `resourceType` in the same workspace; that invariant is enforced both in
 * the application layer and by the `folder_parent_resource_type_match` trigger, since a
 * plain FK cannot express it.
 *
 * `locked` carries over the existing workflow-folder lock feature verbatim. It is NOT
 * extended to the other resource types — file/knowledge_base/table folders leave it at
 * `false` and no lock cascade reads it for them. Dropping the column would regress
 * shipped workflow-folder locking.
 *
 * `color` and `isExpanded` from the old `workflow_folder` table are intentionally not
 * carried over:
 * `color` has no UI consumer, and `isExpanded`'s real state lives client-side in the
 * folders Zustand store and is never read back from the DB.
 */
export const folder = pgTable(
  'folder',
  {
    id: text('id').primaryKey(),
    resourceType: folderResourceTypeEnum('resource_type').notNull(),
    name: text('name').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => folder.id, {
      onDelete: 'set null',
    }),
    locked: boolean('locked').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    userIdx: index('folder_user_idx').on(table.userId),
    workspaceResourceParentIdx: index('folder_workspace_resource_parent_idx').on(
      table.workspaceId,
      table.resourceType,
      table.parentId
    ),
    parentSortIdx: index('folder_parent_sort_idx').on(table.parentId, table.sortOrder),
    deletedAtIdx: index('folder_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('folder_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
    /**
     * Carries over the active-unique key the old `workspace_file_folders` table enforced,
     * and extends it to workflow folders, which never had one — 0272's backfill deduplicated
     * the 47 pre-existing violations it surfaced.
     */
    workspaceResourceParentNameActiveUnique: uniqueIndex(
      'folder_workspace_resource_parent_name_active_unique'
    )
      .on(table.workspaceId, table.resourceType, sql`coalesce(${table.parentId}, '')`, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
)

/**
 * Per-user pinning of workspace resources. Polymorphic on `resourceType`, following
 * the same shape as `publicShare.resourceType` below — deliberately plain `text`
 * rather than a `pgEnum`, because the set of pinnable kinds is expected to grow
 * (folders become pinnable alongside the generic-folder work) and widening a text
 * column costs nothing where widening an enum needs a migration.
 *
 * Pins are per-user, not per-workspace: two members of the same workspace pin
 * independently, which is why `userId` leads the unique index and every read path
 * filters on the session user.
 */
export const pinnedItem = pgTable(
  'pinned_item',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(), // 'workflow' | 'file' | 'knowledge_base' | 'table' | 'folder' | 'workspace'
    resourceId: text('resource_id').notNull(),
    pinnedAt: timestamp('pinned_at').notNull().defaultNow(),
  },
  (table) => ({
    userWorkspaceIdx: index('pinned_item_user_workspace_idx').on(table.userId, table.workspaceId),
    resourceIdx: index('pinned_item_resource_idx').on(table.resourceType, table.resourceId),
    userResourceUnique: uniqueIndex('pinned_item_user_resource_unique').on(
      table.userId,
      table.resourceType,
      table.resourceId
    ),
  })
)

export const workflow = pgTable(
  'workflow',
  {
    id: text('id').primaryKey(),
    /**
     * Creator and owner. Legitimate as ownership: it anchors personal
     * (workspace-less) workflows, cascades the workflow away with the account,
     * and names the owner for webhook config and deploy-as-block resolution.
     *
     * @deprecated As an execution identity. Do not use it to decide who a run
     * acts as, what it may read, or what it may authorize. The acting principal
     * is `ExecutionMetadata.userId`, which the principal layer
     * (`resolvePrincipalAttribution`) resolves to the caller for a session,
     * personal API key, or delegated run, and to the workspace billing account
     * for a workspace API key, schedule, or webhook.
     *
     * Exactly one execution use survives, carried as
     * `ExecutionMetadata.workflowUserId`: the personal-environment fallback in
     * `executeWorkflowCore`, for runs with no identifiable caller — workspace
     * API keys, schedules, webhooks, and unauthenticated public-API calls. Those
     * have nobody to resolve personal variables as, and a deployed workflow is
     * routinely authored against its owner's personal keys, so dropping the
     * fallback would break them. Workspace variables never fall back here; they
     * always authorize against the actor.
     */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => folder.id, { onDelete: 'set null' }),
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
    activeWorkspaceSortIdx: index('workflow_active_workspace_sort_idx')
      .on(table.workspaceId, table.sortOrder, table.createdAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
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
    errorEnabled: boolean('error_enabled').notNull().default(false),
    /** Opt-in {@link BlockRetryConfig}; NULL means the block never retries. */
    retry: jsonb('retry'),
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
    /** See `PERSISTED_WORKFLOW_EXECUTION_STATUSES` in `apps/sim/lib/logs/types.ts`. */
    status: text('status').notNull().default('running'),
    trigger: text('trigger').notNull(), // 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'

    startedAt: timestamp('started_at').notNull(),
    /** Absolute deadline for the current active attempt; cleared while paused or terminal. */
    executionDeadlineAt: timestamp('execution_deadline_at'),
    endedAt: timestamp('ended_at'),
    /**
     * Wall clock from `started_at` for a terminal row; for a `pending` (paused)
     * row, the active duration recorded at the checkpoint, which excludes the
     * time the run sits waiting. Resuming leaves that checkpoint value in place
     * while the row accrues time again, so a `running` row's value is stale
     * until the next terminal write recomputes it.
     */
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
    // contract-pending(after #7134 is fully deployed to production): DROP COLUMN
    // cost. Same procedure and argless-read lint as the user_stats marker
    // (scripts/check-pending-drop-tables.ts). Script migration
    // 0009_backfill_wel_residual_cost_total projects the ~23 straggler rows
    // whose json still held a numeric total into cost_total before the drop;
    // the contract PR must ALSO deregister that script (it reads this column).
    /** @deprecated Not written/read; cost lives in usage_log + the `cost_total` projection. */
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
    runningExecutionDeadlineIdx: index('workflow_execution_logs_running_deadline_idx')
      .on(table.executionDeadlineAt)
      .where(sql`${table.status} = 'running' AND ${table.executionDeadlineAt} IS NOT NULL`),
    redactingStartedAtIdx: index('workflow_execution_logs_redacting_started_at_idx')
      .on(table.startedAt)
      .where(sql`status = 'redacting'`),
    redactingExecutionDeadlineIdx: index('workflow_execution_logs_redacting_deadline_idx')
      .on(table.executionDeadlineAt)
      .where(sql`${table.status} = 'redacting' AND ${table.executionDeadlineAt} IS NOT NULL`),
    completedEndedAtIdx: index('workflow_execution_logs_completed_ended_at_idx')
      .on(table.endedAt, table.workspaceId, table.executionId)
      .where(
        sql`${table.status} = 'completed' AND ${table.level} = 'info' AND ${table.endedAt} IS NOT NULL`
      ),
  })
)

/**
 * Live columns of `workflow_execution_logs` while the `cost` drop is
 * outstanding — see `userStatsColumns` for the pattern.
 */
export const workflowExecutionLogColumns = omit(getTableColumns(workflowExecutionLogs), ['cost'])

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
    /**
     * Backs the `ON DELETE SET NULL` referential trigger, which runs
     * `UPDATE ... WHERE workflow_id = $1` once per deleted workflow row and
     * would otherwise sequentially scan this table each time.
     */
    workflowIdIdx: index('execution_large_values_workflow_id_idx').on(table.workflowId),
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
    /** Backs the `ON DELETE SET NULL` referential trigger — see `executionLargeValues`. */
    workflowIdIdx: index('execution_large_value_references_workflow_id_idx').on(table.workflowId),
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

/** Which principal a run resolved a secret under, and which surface asked for it. */
export const secretUsageScopeEnum = pgEnum('secret_usage_scope', ['workspace', 'personal'])
export const secretUsageSourceEnum = pgEnum('secret_usage_source', ['workflow', 'copilot', 'mcp'])

/**
 * Per-day rollup of which secrets a run actually resolved.
 *
 * Execution logs cannot answer this. They persist the whole *available* encrypted
 * environment rather than what a run referenced, they only evidence a secret where
 * value-matching redaction happened to fire, and they expire under
 * `DataRetentionSettings.logRetentionHours`. A secret's usage trail has to outlive its
 * runs' logs, so it is written here instead of derived from them.
 *
 * Rows are a rollup rather than one per run: a workflow on a one-minute schedule
 * touching three secrets would otherwise write thousands of rows a day, which is also
 * why this is not `audit_log` — that table is a human-scale compliance surface and
 * machine-scale rows would drown it.
 *
 * `secretScope` and `secretOwnerUserId` are part of the key because a workspace secret and a
 * personal secret can share a name — as can two people's personal secrets — and none of them
 * may merge. `lastTriggeredByUserId` is deliberately *not* in the key: a public endpoint
 * called by many people would otherwise fragment one bucket per caller.
 */
export const secretUsage = pgTable(
  'secret_usage',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Matches `credential.envKey`; the trail is keyed by name, not by credential row. */
    secretName: text('secret_name').notNull(),
    secretScope: secretUsageScopeEnum('secret_scope').notNull(),
    /**
     * Whose personal secret this was; empty for a workspace one, which the workspace owns.
     *
     * Two people can hold personal secrets under the same name, and a personal secret shared
     * with the workspace resolves for callers who do not own it, so name and scope alone do
     * not identify a secret. Without this column one person's trail would show another's runs.
     * Not the same as `actorUserId`: a scheduled run resolves the workflow owner's personal
     * slice under the workspace's execution actor.
     */
    secretOwnerUserId: text('secret_owner_user_id').notNull().default(''),
    source: secretUsageSourceEnum('source').notNull(),
    /**
     * Empty for a Copilot or MCP resolution, which has no workflow.
     *
     * Empty string rather than null because both this and `actorUserId` sit inside the unique
     * key below, and Postgres treats nulls as distinct — two Copilot rows would never collide,
     * so the upsert would insert forever instead of incrementing. A sentinel keeps the upsert
     * identity explicit and null-free rather than relying on nullable uniqueness semantics.
     *
     * Deliberately not a foreign key, and neither is `actorUserId`. An `onDelete: 'set null'`
     * would rewrite a key column, so two rows differing only by the deleted id would collide
     * and an ordinary workflow or account deletion would fail on this constraint. They are
     * historical facts in a usage ledger rather than live references, so they are stored as
     * plain ids and joined leniently; a row outliving its workflow is the point of a trail.
     */
    workflowId: text('workflow_id').notNull().default(''),
    /** Whose access authorized the resolution — the run's actor; empty when there is none. */
    actorUserId: text('actor_user_id').notNull().default(''),
    /** UTC day bucket. */
    usageDate: date('usage_date').notNull(),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at').notNull(),
    /** Deep-links the most recent run in Logs, where the block and its code are visible. */
    lastExecutionId: text('last_execution_id'),
    /**
     * The surface the most recent run came in through (`api`, `webhook`, `schedule`,
     * `manual`, `chat`, `copilot`). There is deliberately no separate "triggered by" column:
     * for every trigger kind the executor can name a caller, that caller *is* `actorUserId`,
     * and for the rest (schedule, webhook, workspace key) no human triggered the run at all.
     */
    lastTrigger: text('last_trigger'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    /** Every column is non-null, so ordinary unique semantics make the upsert increment. */
    bucketUnique: uniqueIndex('secret_usage_bucket_unique').on(
      table.workspaceId,
      table.secretName,
      table.secretScope,
      table.secretOwnerUserId,
      table.source,
      table.workflowId,
      table.actorUserId,
      table.usageDate
    ),
    secretRecentIdx: index('secret_usage_secret_recent_idx').on(
      table.workspaceId,
      table.secretName,
      table.secretScope,
      table.secretOwnerUserId,
      table.lastUsedAt.desc()
    ),
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

export const organizationBYOKKeys = pgTable(
  'organization_byok_keys',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    name: text('name'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationProviderIdx: index('organization_byok_organization_provider_idx').on(
      table.organizationId,
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
  autoFocusOnClick: boolean('auto_focus_on_click').notNull().default(true),

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
    secretScope: text('secret_scope').notNull().default('all'),
    mountedSecrets: jsonb('mounted_secrets').$type<string[]>().notNull().default([]),
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
     * native Slack and TikTok triggers) whose events arrive on a single shared
     * endpoint and route by `routingKey` instead of a per-workflow path.
     */
    path: text('path'),
    /**
     * Tenant routing key for shared-app providers, such as Slack `team_id` or
     * TikTok `open_id`, derived server-side from the connected credential at
     * deploy time — never user input. Inbound events match on this after HMAC
     * verification.
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
  // contract-pending(after #7134 is fully deployed to production): DROP COLUMN
  // the 19 @deprecated columns in this table. Their last readers/writers were
  // removed by the ledger cutover (#7078/#7113) and #7134; the declarations
  // remain ONLY so the app schema keeps matching the deployed database until
  // the drop. Argless select()/relational reads of this table are forbidden
  // meanwhile — they would put these columns back into generated SQL and break
  // the old task set when the contract deploy drops them mid-cutover — enforced
  // by scripts/check-pending-drop-tables.ts. The follow-up PR deletes the
  // @deprecated declarations plus this marker and ships the generated DROP
  // migration in the same change.
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
  /** @deprecated No readers or writers; report cost from usage_log. */
  totalCost: decimal('total_cost').notNull().default('0'),
  currentUsageLimit: decimal('current_usage_limit').default(DEFAULT_FREE_CREDITS.toString()), // Default $5 (1,000 credits) for free plan, null for team/enterprise
  usageLimitUpdatedAt: timestamp('usage_limit_updated_at').defaultNow(),
  /** @deprecated No readers or writers; usage is the attributed usage_log ledger. Drop via DROP COLUMN in a follow-up migration. */
  currentPeriodCost: decimal('current_period_cost').notNull().default('0'),
  /** Previous-period usage; written by the cycle-close sweep from ledger sums. */
  lastPeriodCost: decimal('last_period_cost').default('0'),
  /**
   * Threshold/final billing tracker.
   *
   * Incremented when threshold billing collects overage mid-period; reset to
   * zero by the cycle-close sweep at period rollover. It is not incremented
   * by the ordinary per-usage ledger write path.
   */
  billedOverageThisPeriod: decimal('billed_overage_this_period').notNull().default('0'), // Amount of overage already billed via threshold billing
  /** @deprecated No readers or writers; ledger entity stamps attribute pre/post-join usage. Drop via DROP COLUMN in a follow-up migration. */
  proPeriodCostSnapshot: decimal('pro_period_cost_snapshot').default('0'),
  /** @deprecated No readers or writers; see proPeriodCostSnapshot. Drop via DROP COLUMN in a follow-up migration. */
  proPeriodCostSnapshotAt: timestamp('pro_period_cost_snapshot_at'),
  /**
   * Credit balance tracker.
   *
   * Still debited/credited by billing lifecycle paths and threshold/final
   * overage collection. It is not a per-usage aggregate counter.
   */
  creditBalance: decimal('credit_balance').notNull().default('0'),
  /** @deprecated No readers or writers; report Copilot cost from usage_log. */
  totalCopilotCost: decimal('total_copilot_cost').notNull().default('0'),
  /** @deprecated No readers or writers; Copilot usage is the copilot-source usage_log ledger. Drop via DROP COLUMN in a follow-up migration. */
  currentPeriodCopilotCost: decimal('current_period_copilot_cost').notNull().default('0'),
  /** Previous-period Copilot cost; written by the cycle-close sweep from copilot-source ledger sums. */
  lastPeriodCopilotCost: decimal('last_period_copilot_cost').default('0'),
  /** @deprecated No readers or writers; report Copilot tokens from usage_log. */
  totalCopilotTokens: bigint('total_copilot_tokens', { mode: 'number' }).notNull().default(0),
  /** @deprecated No readers or writers; report Copilot calls from usage_log. */
  totalCopilotCalls: integer('total_copilot_calls').notNull().default(0),
  /** @deprecated No readers or writers; report MCP Copilot calls from usage_log. */
  totalMcpCopilotCalls: integer('total_mcp_copilot_calls').notNull().default(0),
  /** @deprecated No readers or writers; report MCP Copilot cost from usage_log. */
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
  /** @deprecated No readers or writers; not updated since execution stopped writing user_stats. */
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

/**
 * Live columns of `user_stats` — the selection every read of this table goes
 * through while the contract-pending drop (see the marker inside the table) is
 * outstanding, so generated SQL never names the doomed columns. Enforced by
 * `scripts/check-pending-drop-tables.ts`; the contract PR deletes this helper
 * together with the deprecated declarations.
 */
export const userStatsColumns = omit(getTableColumns(userStats), [
  'totalManualExecutions',
  'totalApiCalls',
  'totalWebhookTriggers',
  'totalScheduledExecutions',
  'totalChatExecutions',
  'totalMcpExecutions',
  'totalTokensUsed',
  'totalCost',
  'currentPeriodCost',
  'proPeriodCostSnapshot',
  'proPeriodCostSnapshotAt',
  'totalCopilotCost',
  'currentPeriodCopilotCost',
  'totalCopilotTokens',
  'totalCopilotCalls',
  'totalMcpCopilotCalls',
  'totalMcpCopilotCost',
  'currentPeriodMcpCopilotCost',
  'lastActive',
])

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

/**
 * Editor grants for a skill. A row makes the user an editor (edit, delete,
 * share); workspace admins are derived editors and need no rows. Everyone with
 * workspace access can see and use every skill regardless of rows.
 */
export const skillMember = pgTable(
  'skill_member',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id')
      .notNull()
      .references(() => skill.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('skill_member_user_id_idx').on(table.userId),
    uniqueMembership: uniqueIndex('skill_member_unique').on(table.skillId, table.userId),
  })
)

export const mothershipSettings = pgTable('mothership_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  mcpToolRefs: jsonb('mcp_tool_refs').notNull().default(sql`'[]'::jsonb`),
  customToolRefs: jsonb('custom_tool_refs').notNull().default(sql`'[]'::jsonb`),
  skillRefs: jsonb('skill_refs').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
    /**
     * Durable cycle-close marker: the `periodStart` of the most recent period
     * whose close (final overage collection, `billedOverageThisPeriod` reset,
     * last-period bookkeeping) has been committed. The daily cycle-close sweep
     * closes the previous period whenever this lags the row's `periodStart`,
     * then advances it. Null = never initialized; the first sweep initializes
     * it to the current `periodStart` without billing so historical periods
     * are never retroactively closed.
     */
    lastClosedPeriodStart: timestamp('last_closed_period_start'),
  },
  (table) => ({
    referenceStatusIdx: index('subscription_reference_status_idx').on(
      table.referenceId,
      table.status
    ),
    /**
     * Partial index for the cycle-close sweep's keyset iteration: exactly the
     * entitled subscriptions whose close marker lags the current period. The
     * predicate must mirror the sweep query in `lib/billing/cycle-close.ts`
     * (status list = ENTITLED_SUBSCRIPTION_STATUSES, hardcoded here because
     * packages cannot import from apps); a drifted predicate degrades to a
     * seq scan, never a wrong result. The index stays tiny — closes remove
     * rows from it — so the candidate scan is O(lagging), not O(fleet).
     */
    cycleCloseLaggingIdx: index('subscription_cycle_close_lagging_idx')
      .on(table.id)
      .where(
        sql`${table.status} in ('active', 'past_due') and ${table.periodStart} is not null and (${table.lastClosedPeriodStart} is null or ${table.lastClosedPeriodStart} < ${table.periodStart})`
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
  blockedUntil: timestamp('blocked_until'),
  /** Bounded adaptive provider budgets and expiring request leases; ordinary buckets leave it null. */
  capacityState: jsonb('capacity_state'),
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

    /**
     * When true, public chat SSE exposes provider thinking events. Independent
     * of the `X-Sim-Stream-Protocol` header, which governs answer-text cadence
     * rather than frame exposure. Default off — never derived from auth type or
     * isSecureMode.
     */
    includeThinking: boolean('include_thinking').notNull().default(false),
    /**
     * When true, public chat SSE exposes tool lifecycle events. Independent of
     * includeThinking and of the protocol header.
     *
     * Nullable only because the column was added after the table; readers treat
     * null as false.
     */
    // contract-pending(any release): normalize nulls to false, then set DEFAULT false and NOT NULL — cosmetic only, since no reader distinguishes null from false
    includeToolCalls: boolean('include_tool_calls'),

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

/**
 * Org-level session policy (enterprise). Absent or empty = Better Auth
 * defaults (30-day sliding sessions). `maxSessionHours` caps absolute session
 * lifetime from creation; `idleTimeoutHours` caps time between refreshes.
 * Enforced by clamping `session.expiresAt` in the Better Auth session
 * create/update database hooks; `securityPolicyVersion` invalidates cached
 * session cookies org-wide when bumped.
 */
export interface SessionPolicySettings {
  /** Absolute session lifetime cap in hours from session creation. */
  maxSessionHours?: number | null
  /** Idle timeout in hours — session expires this long after its last refresh. */
  idleTimeoutHours?: number | null
}

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: json('metadata'),
  sessionPolicySettings: json('session_policy_settings').$type<SessionPolicySettings>(),
  /**
   * Monotonic counter embedded in the Better Auth cookie-cache version for
   * this org's members. Bumped on any security-policy change or org-wide
   * session revocation so every cached session cookie in the org is
   * invalidated (falls through to a DB session read) within the policy
   * cache TTL instead of the 24h cookie-cache lifetime.
   */
  securityPolicyVersion: integer('security_policy_version').notNull().default(1),
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
  // contract-pending(after #7134 is fully deployed to production): DROP COLUMN
  // departed_member_usage. The last readers/writers (v1 admin exposure,
  // cycle-close resets) were removed in #7134; same procedure and argless-read
  // lint as the user_stats marker (scripts/check-pending-drop-tables.ts).
  /** @deprecated No readers or writers; a departed member's ledger rows stay stamped to the org's period, so nothing needs capturing. */
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

/**
 * Live columns of `organization` while the `departed_member_usage` drop is
 * outstanding — see `userStatsColumns` for the pattern.
 */
export const organizationColumns = omit(getTableColumns(organization), ['departedMemberUsage'])

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
    inboxSecretScope: text('inbox_secret_scope').notNull().default('all'),
    inboxMountedSecrets: jsonb('inbox_mounted_secrets').$type<string[]>().notNull().default([]),
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
    /**
     * Routes an unauthenticated AgentMail delivery to exactly one tenant's
     * webhook secret. Unique so "one signature check per request" is a storage
     * invariant rather than something the receiver has to defend against, and
     * partial because only a small fraction of workspaces enable an inbox.
     */
    inboxProviderIdIdx: uniqueIndex('workspace_inbox_provider_id_idx')
      .on(table.inboxProviderId)
      .where(sql`${table.inboxProviderId} IS NOT NULL`),
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
  /** Canonical path identity for a workspace file-folder referenced by a workflow. */
  'file_folder',
  'mcp_server',
  /** Workflow-publishing MCP server identity (fork shell copy), for attachment sync. */
  'workflow_mcp_server',
  /**
   * Published custom block (deploy-as-block). Mapped, never copied: a custom block is
   * org-scoped and binds a workflow in the PUBLISHER's workspace, so an environment fork
   * repoints its placed blocks at the environment's own block rather than duplicating one.
   */
  'custom_block',
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
    deletedAtIdx: index('workspace_file_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('workspace_file_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
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
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    folderId: text('folder_id').references(() => folder.id, { onDelete: 'set null' }),
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
    /** contract-pending(after the cutover is fully deployed and size_bytes has no NULLs): drop size, workspace_files_sync_size_columns, and the temporary dev cutover runner — all application reads and writes use size_bytes */
    size: integer('size').notNull().default(0),
    /** Exact byte size. The deploy migration backfills existing rows before this release serves traffic. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /**
     * Intrinsic pixel dimensions of an image file, captured lazily on first view (and stored so later
     * views reserve layout space before the image loads, via aspect-ratio). NULL for non-images and for
     * rows not yet backfilled. Purely a rendering hint — never affects stored file content.
     */
    width: integer('width'),
    height: integer('height'),
    deletedAt: timestamp('deleted_at'),
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    /**
     * Content-scoped version: advances ONLY when the file's CONTENT changes (upload / content
     * overwrite), never on metadata writes (rename, move, soft-delete, restore). It is the
     * optimistic-concurrency validator the collaborative-document persist guards on (RFC 7232 `If-Match`
     * semantics: validate the representation, not the row) — so a rename can't make a racing live-doc
     * persist see a stale token, reconcile stale durable content, and clobber in-flight edits. NOT NULL
     * with a `now()` default: Postgres applies this as a fast-default (no table rewrite), existing rows
     * get a stable timestamp that — like every metadata write — never advances it, and every insert path
     * is covered without per-call plumbing. Only a content write (upload / overwrite) advances it.
     */
    contentUpdatedAt: timestamp('content_updated_at').notNull().defaultNow(),
    /**
     * Durable cutover marker for content secret provenance. NULL is reserved for legacy rows and
     * writes from app versions that predate tracking. Provenance-aware writers set version 1 in the
     * same transaction as the matching sidecar. A tracked version without a matching sidecar fails
     * closed.
     */
    secretProvenanceVersion: integer('secret_provenance_version'),
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
    organizationBindingCheck: check(
      'workspace_files_organization_binding_check',
      sql`${table.organizationId} IS NULL OR (${table.workspaceId} IS NULL AND ${table.context} = 'knowledge-base' AND ${table.folderId} IS NULL AND ${table.chatId} IS NULL)`
    ),
    organizationIdIdx: index('workspace_files_organization_id_idx').on(table.organizationId),
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

/** Canonical application projection; the legacy `size` bridge is migration-only. */
export const workspaceFileColumns = omit(getTableColumns(workspaceFiles), ['size'])
export type WorkspaceFileRow = Omit<typeof workspaceFiles.$inferSelect, 'size'>

export const workspaceFileSearchIndexStatusEnum = pgEnum('workspace_file_search_index_status', [
  'pending',
  'ready',
  'skipped',
  'failed',
])

/** Current and historical search-index state for one immutable workspace-file content revision. */
export const workspaceFileSearchIndex = pgTable(
  'workspace_file_search_index',
  {
    fileId: text('file_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    sourceContentUpdatedAt: timestamp('source_content_updated_at').notNull(),
    status: workspaceFileSearchIndexStatusEnum('status').notNull().default('pending'),
    partial: boolean('partial').notNull().default(false),
    failureReason: text('failure_reason'),
    lineCount: integer('line_count').notNull().default(0),
    indexedBytes: integer('indexed_bytes').notNull().default(0),
    dispatchedAt: timestamp('dispatched_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'workspace_file_search_index_pk',
      columns: [table.fileId, table.sourceContentUpdatedAt],
    }),
    fileFk: foreignKey({
      name: 'workspace_file_search_index_file_fk',
      columns: [table.fileId],
      foreignColumns: [workspaceFiles.id],
    }).onDelete('cascade'),
    workspaceFk: foreignKey({
      name: 'workspace_file_search_index_workspace_fk',
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete('cascade'),
    workspaceStatusIdx: index('workspace_file_search_index_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.sourceContentUpdatedAt
    ),
    pendingDispatchIdx: index('workspace_file_search_index_pending_dispatch_idx')
      .on(table.workspaceId, table.updatedAt, table.fileId, table.sourceContentUpdatedAt)
      .where(sql`${table.status} = 'pending' AND ${table.dispatchedAt} IS NULL`),
    activeDispatchIdx: index('workspace_file_search_index_active_dispatch_idx')
      .on(table.workspaceId, table.dispatchedAt)
      .where(sql`${table.status} = 'pending' AND ${table.dispatchedAt} IS NOT NULL`),
  })
)

/** One bounded scheduler row per workspace with current file revisions awaiting dispatch. */
export const workspaceFileSearchDispatchQueue = pgTable(
  'workspace_file_search_dispatch_queue',
  {
    workspaceId: text('workspace_id').primaryKey(),
    enqueuedAt: timestamp('enqueued_at').notNull().defaultNow(),
    lastDispatchedAt: timestamp('last_dispatched_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceFk: foreignKey({
      name: 'workspace_file_search_queue_workspace_fk',
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete('cascade'),
    scheduleIdx: index('workspace_file_search_dispatch_queue_schedule_idx').on(
      table.lastDispatchedAt.asc().nullsFirst(),
      table.enqueuedAt,
      table.workspaceId
    ),
  })
)

/** Singleton keyset cursor for the resumable initial workspace-file search backfill. */
export const workspaceFileSearchBackfill = pgTable('workspace_file_search_backfill', {
  id: text('id').primaryKey(),
  afterWorkspaceId: text('after_workspace_id'),
  afterFileId: text('after_file_id'),
  completedAt: timestamp('completed_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/** Bounded, overlapping logical-line segments searched through PostgreSQL trigram indexes. */
export const workspaceFileSearchSegment = pgTable(
  'workspace_file_search_segment',
  {
    fileId: text('file_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    sourceContentUpdatedAt: timestamp('source_content_updated_at').notNull(),
    lineNumber: integer('line_number').notNull(),
    segmentNumber: integer('segment_number').notNull(),
    segmentStart: integer('segment_start').notNull(),
    lineLength: integer('line_length').notNull(),
    content: text('content').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'workspace_file_search_segment_pk',
      columns: [table.fileId, table.sourceContentUpdatedAt, table.lineNumber, table.segmentNumber],
    }),
    fileFk: foreignKey({
      name: 'workspace_file_search_segment_file_fk',
      columns: [table.fileId],
      foreignColumns: [workspaceFiles.id],
    }).onDelete('cascade'),
    workspaceFk: foreignKey({
      name: 'workspace_file_search_segment_workspace_fk',
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete('cascade'),
    workspaceRevisionIdx: index('workspace_file_search_segment_workspace_revision_idx').on(
      table.workspaceId,
      table.fileId,
      table.sourceContentUpdatedAt
    ),
    contentTrigramIdx: index('workspace_file_search_segment_workspace_content_trgm_idx').using(
      'gin',
      table.workspaceId.asc().op('text_ops'),
      table.content.asc().op('gin_trgm_ops')
    ),
  })
)

export const uploadSessionStatusEnum = pgEnum('upload_session_status', [
  'uploading',
  'completing',
  'finalizing',
  'completed',
  'aborting',
  'aborted',
  'failed',
  'expired',
])

export const uploadSessionMethodEnum = pgEnum('upload_session_method', ['put', 'multipart'])

export const uploadSessionProviderEnum = pgEnum('upload_session_provider', [
  'local',
  's3',
  'blob',
  'gcs',
])

export const uploadSessionPurposeEnum = pgEnum('upload_session_purpose', [
  'workspace_file',
  'table_import',
  'knowledge_document',
  'profile_picture',
  'workspace_logo',
  'mothership_attachment',
  'execution_attachment',
])

/** Durable control-plane state for direct-to-provider PUT and multipart uploads. */
export const uploadSession = pgTable(
  'upload_session',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id').notNull(),
    workspaceId: text('workspace_id'),
    knowledgeBaseId: text('knowledge_base_id'),
    workflowId: text('workflow_id'),
    executionId: text('execution_id'),
    purpose: uploadSessionPurposeEnum('purpose').notNull(),
    method: uploadSessionMethodEnum('method').notNull(),
    storageContext: text('storage_context').notNull(),
    finalKey: text('final_key').notNull(),
    storageProvider: uploadSessionProviderEnum('storage_provider').notNull(),
    providerUploadId: text('provider_upload_id'),
    providerObjectVersion: text('provider_object_version'),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    partSize: integer('part_size'),
    partCount: integer('part_count'),
    status: uploadSessionStatusEnum('status').notNull().default('uploading'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    processingLeaseId: text('processing_lease_id'),
    processingLeaseExpiresAt: timestamp('processing_lease_expires_at'),
    completedFileId: text('completed_file_id'),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('upload_session_token_hash_unique').on(table.tokenHash),
    finalKeyUnique: uniqueIndex('upload_session_final_key_unique').on(table.finalKey),
    statusExpiresAtIdx: index('upload_session_status_expires_at_idx').on(
      table.status,
      table.expiresAt
    ),
  })
)

export interface WorkspaceFileSecretProvenanceEntry extends DurableSecretProvenanceEntry {
  sourceUserId: string
}

export interface StoredWorkspaceFileSecretProvenanceEntry
  extends WorkspaceFileSecretProvenanceEntry {
  name: string
  anonymous?: true
}

/**
 * Private, durable provenance for bytes stored in `workspace_files`.
 *
 * Absence is reserved for legacy files that predate provenance tracking. `exact` records carry the
 * encrypted values found in one content version (including an empty set); `unknown` records fail
 * closed at model attachment boundaries. Keeping this one-to-one state outside `workspace_files`
 * prevents private metadata from leaking through broad workspace-file record projections.
 */
export const workspaceFileSecretProvenance = pgTable(
  'workspace_file_secret_provenance',
  {
    fileId: text('file_id')
      .primaryKey()
      .references(() => workspaceFiles.id, { onDelete: 'cascade' }),
    contentUpdatedAt: timestamp('content_updated_at').notNull(),
    status: text('status').notNull(),
    entries: jsonb('entries')
      .$type<StoredWorkspaceFileSecretProvenanceEntry[]>()
      .notNull()
      .default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'workspace_file_secret_provenance_status_check',
      sql`${table.status} IN ('exact', 'unknown', 'unrecorded')`
    ),
  })
)

export interface DurableSecretProvenanceEntry {
  encryptedValue: string
  name?: string
  sourceUserId?: string
  sourceWorkspaceId?: string
  /** Optional canonical hash of the exact persisted sub-value that contributed this entry. */
  sourceValueHash?: string
}

export interface TableRowSecretProvenanceEntry extends DurableSecretProvenanceEntry {
  columnId: string
}

/**
 * Cached collaborative-document state for a workspace markdown file: the last-persisted Yjs binary and
 * a hash of the markdown it was derived from. On a cold room open the seed loads this binary directly
 * (the Hocuspocus load-document pattern) rather than re-converting markdown → Yjs — which avoids the
 * "recreate the CRDT from a non-binary format" anti-pattern (fresh client ids / content duplication on
 * reconnect) and the server-side headless-editor conversion. The row is STALE, and the seed re-converts
 * from markdown, when `sourceHash` no longer matches the file's current markdown (edited externally by a
 * copilot write or a direct save). One row per file; dropped by FK cascade when the file is deleted.
 */
export const workspaceFileCollabState = pgTable('workspace_file_collab_state', {
  fileId: text('file_id')
    .primaryKey()
    .references(() => workspaceFiles.id, { onDelete: 'cascade' }),
  /** `Y.encodeStateAsUpdate` of the collaborative doc at last persist — apply with `Y.applyUpdate`. */
  docState: bytea('doc_state').notNull(),
  /** sha256 (hex) of the markdown `docState` was derived from — the freshness tag for cold-start. */
  sourceHash: text('source_hash').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
    /** NULL is a legacy/untracked record; version 1 requires a fresh private sidecar. */
    secretProvenanceVersion: integer('secret_provenance_version'),
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

/** Private provenance bound to one exact canonical hash of the persisted memory data. */
export const memorySecretProvenance = pgTable(
  'memory_secret_provenance',
  {
    memoryId: text('memory_id')
      .primaryKey()
      .references(() => memory.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    entries: jsonb('entries').$type<DurableSecretProvenanceEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'memory_secret_provenance_status_check',
      sql`${table.status} IN ('exact', 'unknown')`
    ),
  })
)

/** Organization Search approval is independent of credentials, sources, and sync status. */
export const organizationSearchIntegration = pgTable(
  'organization_search_integration',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    connectorType: text('connector_type').notNull(),
    approved: boolean('approved').notNull(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.connectorType] })]
)

export const knowledgeBase = pgTable(
  'knowledge_base',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    folderId: text('folder_id').references(() => folder.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Search indexes retain their identity independently of their display name. */
    isSearchIndex: boolean('is_search_index').notNull().default(false),

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
    ownerCheck: check(
      'kb_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationSearchIndexCheck: check(
      'kb_organization_search_index_check',
      sql`${table.organizationId} IS NULL OR ${table.isSearchIndex}`
    ),
    organizationIdIdx: index('kb_organization_id_idx').on(table.organizationId),
    organizationFolderCheck: check(
      'kb_organization_folder_check',
      sql`${table.organizationId} IS NULL OR ${table.folderId} IS NULL`
    ),
    organizationSearchIndexUnique: uniqueIndex('kb_organization_search_index_unique')
      .on(table.organizationId)
      .where(sql`${table.isSearchIndex} = true AND ${table.deletedAt} IS NULL`),
    organizationNameActiveUnique: uniqueIndex('kb_organization_name_active_unique')
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    // Primary access patterns
    userIdIdx: index('kb_user_id_idx').on(table.userId),
    workspaceIdIdx: index('kb_workspace_id_idx').on(table.workspaceId),
    // Composite index for user's workspaces
    userWorkspaceIdx: index('kb_user_workspace_idx').on(table.userId, table.workspaceId),
    folderIdIdx: index('kb_folder_id_idx').on(table.folderId),
    // Index for soft delete filtering
    deletedAtIdx: index('kb_deleted_at_idx').on(table.deletedAt),
    workspaceDeletedAtPartialIdx: index('kb_workspace_deleted_partial_idx')
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
    /** One active (non-deleted) name per workspace; matches user_table_definitions pattern */
    workspaceNameActiveUnique: uniqueIndex('kb_workspace_name_active_unique')
      .on(table.workspaceId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    workspaceSearchIndexUnique: uniqueIndex('kb_workspace_search_index_unique')
      .on(table.workspaceId)
      .where(sql`${table.isSearchIndex} = true AND ${table.deletedAt} IS NULL`),
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
    /**
     * Dispatches spent on this document since its last successful pass.
     *
     * A bounded retry budget, not a dispatch generation. The stuck-document
     * sweep re-dispatches a failing document every sync for the whole retry
     * window, and each dispatch re-parses and re-embeds it — so a document that
     * fails deterministically was billed once per sync indefinitely. Past the
     * budget it becomes a dead letter: still visible and still user-retryable,
     * but no longer swept. Reset to 0 whenever a pass completes.
     */
    processingAttempts: integer('processing_attempts').notNull().default(0),
    /**
     * When indexing was last dispatched to a worker, which is not when a worker
     * picked it up — a document sits at `pending` in between. Recovery sweeps
     * measure queue wait from here; `processingStartedAt` is written only once a
     * worker actually starts. NULL means never dispatched, or dispatched before
     * this column existed.
     */
    processingQueuedAt: timestamp('processing_queued_at'),
    /** Opaque dispatch generation; NULL identifies payloads created before token rollout. */
    processingQueueToken: text('processing_queue_token'),
    processingStartedAt: timestamp('processing_started_at'),
    /** Scheduled execution time of an accepted durable quota continuation. */
    processingDeferredUntil: timestamp('processing_deferred_until'),
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
    /** NULL is a legacy/untracked source; version 1 requires a matching source sidecar. */
    secretProvenanceVersion: integer('secret_provenance_version'),

    /** User who uploaded the document, for usage attribution. Null for
     *  connector/cron-synced docs (and pre-migration rows) → indexing billing
     *  falls back to the workspace billed account. */
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),

    /**
     * Sorted access-token list applied by every document read; the vocabulary
     * is owned by `apps/sim/lib/knowledge/access/tokens.ts`. `{ws}` (the
     * default) is any workspace member and `{}` is nobody. Uploads, API-created
     * documents, and workspace-mode connectors keep the default; a members-mode
     * connector materialises it from `knowledge_document_observation`.
     */
    acl: text('acl').array().notNull().default(sql`'{ws}'::text[]`),
    /** Additional OR clauses, all of which must match; preserves source permission intersections. */
    aclRequirements: jsonb('acl_requirements').$type<string[][]>().notNull().default([]),
    /** Last authoritative source ACL evidence; NULL fails closed for mirrored permissions. */
    aclVerifiedAt: timestamp('acl_verified_at'),
    /** Source last-modified time when the connector reports one; NULL for uploads. */
    sourceModifiedAt: timestamp('source_modified_at'),
    /** Start of the durable source-listing cycle that last observed this document. */
    sourceSeenAt: timestamp('source_seen_at'),

    // Timestamps
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern - filter by knowledge base
    knowledgeBaseIdIdx: index('doc_kb_id_idx').on(table.knowledgeBaseId),
    /**
     * Serves the access predicate (`acl && tokens`) when a token set is
     * selective — one member's subject over a large base — and the
     * rematerialisation by token (`acl && ARRAY[token]`) a member change
     * triggers. Partial on live rows: every reader already carries
     * `deleted_at IS NULL`.
     */
    aclGinIdx: index('doc_acl_gin_idx')
      .using('gin', table.acl.op('array_ops'))
      .where(sql`${table.deletedAt} IS NULL`),
    /**
     * Every element is a well-formed token. A malformed token never matches a
     * principal, so a write that slipped past the token builder would deny
     * access silently instead of failing loudly here.
     */
    aclTokenShapeCheck: check(
      'doc_acl_token_shape_check',
      sql`array_position(${table.acl}, NULL) IS NULL AND (cardinality(${table.acl}) = 0 OR (cardinality(${table.acl}) = array_length(string_to_array(array_to_string(${table.acl}, E'\\n'), E'\\n'), 1) AND array_to_string(${table.acl}, E'\\n') ~ '^((ws|pub|link|u:[^\\nA-Z]+@[^\\nA-Z]+|[gs]:[^\\n:]+:[^\\n:]+:[^\\n]+)(\\n(ws|pub|link|u:[^\\nA-Z]+@[^\\nA-Z]+|[gs]:[^\\n:]+:[^\\n:]+:[^\\n]+))*)$'))`
    ),
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
    /** Source lookups include historical documents that may reappear. */
    connectorSourceLookupIdx: index('doc_connector_source_lookup_idx').on(
      table.connectorId,
      table.externalId
    ),
    /** Ordered absence reconciliation includes tombstones and skips excluded or archived rows. */
    connectorReconciliationIdx: index('doc_connector_reconciliation_idx')
      .on(table.connectorId, sql`COALESCE(${table.sourceSeenAt}, '-infinity'::timestamp)`, table.id)
      .where(sql`${table.userExcluded} = false AND ${table.archivedAt} IS NULL`),
    activeKnowledgeBaseTokenCountIdx: index('doc_active_kb_token_count_idx')
      .on(table.knowledgeBaseId, table.tokenCount)
      .where(
        sql`${table.userExcluded} = false AND ${table.archivedAt} IS NULL AND ${table.deletedAt} IS NULL`
      ),
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
    tag1Idx: index('doc_kb_tag1_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag1})`),
    tag2Idx: index('doc_kb_tag2_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag2})`),
    tag3Idx: index('doc_kb_tag3_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag3})`),
    tag4Idx: index('doc_kb_tag4_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag4})`),
    tag5Idx: index('doc_kb_tag5_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag5})`),
    tag6Idx: index('doc_kb_tag6_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag6})`),
    tag7Idx: index('doc_kb_tag7_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag7})`),
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

/** Private provenance for a document ingestion source, bound by a deterministic source hash. */
export const documentSecretProvenance = pgTable(
  'document_secret_provenance',
  {
    documentId: text('document_id')
      .primaryKey()
      .references(() => document.id, { onDelete: 'cascade' }),
    sourceHash: text('source_hash').notNull(),
    status: text('status').notNull(),
    entries: jsonb('entries').$type<DurableSecretProvenanceEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'document_secret_provenance_status_check',
      sql`${table.status} IN ('exact', 'unknown')`
    ),
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
    /** NULL is a legacy/untracked chunk; version 1 requires a fresh private sidecar. */
    secretProvenanceVersion: integer('secret_provenance_version'),
    contentLength: integer('content_length').notNull(),
    tokenCount: integer('token_count').notNull(),

    /**
     * Vector embeddings. A chunk populates exactly the one column matching its
     * knowledge base's `embedding_dimension`, and the others stay NULL: pgvector
     * fixes a column's width, so one width per column is the only way to store
     * models that emit different sizes in the same table. The widths cover what
     * the popular embedding models emit — 384 (all-minilm), 768 (nomic-embed-text,
     * embeddinggemma), 1024 (mxbai-embed-large, bge-m3, Voyage), 1536 (OpenAI's
     * small model), 3072 (OpenAI's large model, gemini-embedding-001).
     *
     * `embedding` is the original 1536 column, kept under its bare name so every
     * row written before the other widths existed stays exactly where it is.
     */
    embedding: vector('embedding', { dimensions: 1536 }),
    embedding384: vector('embedding_384', { dimensions: 384 }),
    embedding768: vector('embedding_768', { dimensions: 768 }),
    embedding1024: vector('embedding_1024', { dimensions: 1024 }),
    embedding3072: vector('embedding_3072', { dimensions: 3072 }),
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

    // Vector similarity search indexes (HNSW), one per stored width
    embeddingVectorHnswIdx: index('embedding_vector_hnsw_idx')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .with({
        m: 16,
        ef_construction: 64,
      }),
    embedding384VectorHnswIdx: index('embedding_384_vector_hnsw_idx')
      .using('hnsw', table.embedding384.op('vector_cosine_ops'))
      .with({
        m: 16,
        ef_construction: 64,
      }),
    embedding768VectorHnswIdx: index('embedding_768_vector_hnsw_idx')
      .using('hnsw', table.embedding768.op('vector_cosine_ops'))
      .with({
        m: 16,
        ef_construction: 64,
      }),
    embedding1024VectorHnswIdx: index('embedding_1024_vector_hnsw_idx')
      .using('hnsw', table.embedding1024.op('vector_cosine_ops'))
      .with({
        m: 16,
        ef_construction: 64,
      }),
    /**
     * pgvector indexes `vector` only up to 2,000 dimensions and `halfvec` up to
     * 4,000, so the 3,072 column is indexed through a `halfvec` cast — the
     * recipe pgvector documents for wider vectors.
     *
     * Postgres matches an expression index by its expression, so a query must
     * repeat the cast to use this index. That makes the comparison itself
     * half-precision, not just the index scan; only the stored vector keeps its
     * full width. The cost is nil in practice and bounded in principle: every
     * component of a `text-embedding-3-large` vector is already exactly
     * representable in binary16 as OpenAI serves it (measured across 27,648
     * components: zero changed by the cast), and even a model that is not would
     * move a cosine distance by binary16's ~5e-4 relative error, orders below
     * what reorders a result.
     *
     * The search layer derives its distance expression per width from one place
     * so the query and this index cannot drift apart.
     */
    embedding3072VectorHnswIdx: index('embedding_3072_vector_hnsw_idx')
      .using('hnsw', sql`(${table.embedding3072}::halfvec(3072)) halfvec_cosine_ops`)
      .with({
        m: 16,
        ef_construction: 64,
      }),

    // Text tag indexes
    tag1Idx: index('emb_kb_tag1_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag1})`),
    tag2Idx: index('emb_kb_tag2_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag2})`),
    tag3Idx: index('emb_kb_tag3_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag3})`),
    tag4Idx: index('emb_kb_tag4_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag4})`),
    tag5Idx: index('emb_kb_tag5_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag5})`),
    tag6Idx: index('emb_kb_tag6_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag6})`),
    tag7Idx: index('emb_kb_tag7_lower_idx').on(table.knowledgeBaseId, sql`lower(${table.tag7})`),
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

    /**
     * Exactly one width is populated per chunk. A row with none is an
     * unsearchable chunk that still counts toward the base; a row with two is a
     * width the search layer cannot pick between.
     */
    embeddingWidthCheck: check(
      'embedding_width_check',
      sql`num_nonnulls("embedding", "embedding_384", "embedding_768", "embedding_1024", "embedding_3072") = 1`
    ),
  })
)

/** Private provenance bound to one exact SHA-256 hash of the persisted chunk content. */
export const embeddingSecretProvenance = pgTable(
  'embedding_secret_provenance',
  {
    embeddingId: text('embedding_id')
      .primaryKey()
      .references(() => embedding.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    entries: jsonb('entries').$type<DurableSecretProvenanceEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'embedding_secret_provenance_status_check',
      sql`${table.status} IN ('exact', 'unknown')`
    ),
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
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    type: chatTypeEnum('type').notNull().default('copilot'),
    title: text('title'),
    model: text('model').notNull().default('claude-3-7-sonnet-latest'),
    conversationId: text('conversation_id'),
    previewYaml: text('preview_yaml'),
    /**
     * @deprecated Nothing reads or writes this any more — the plan artifact
     * moved into the message transcript. Kept only so the column survives the
     * deploy that removes its last readers; drop it in a follow-up migration
     * once that deploy has fully rolled out (expand/contract).
     */
    planArtifact: text('plan_artifact'),
    config: jsonb('config'),
    resources: jsonb('resources').notNull().default('[]'),
    // Copilot tool ids the user allowed for the rest of this chat only, as
    // opposed to the account-wide list on `settings.copilotAutoAllowedTools`.
    autoAllowedTools: jsonb('auto_allowed_tools').notNull().default('[]'),
    lastSeenAt: timestamp('last_seen_at'),
    pinned: boolean('pinned').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'copilot_chats_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) <= 1`
    ),
    organizationIdIdx: index('copilot_chats_organization_id_idx').on(table.organizationId),
    organizationWorkflowCheck: check(
      'copilot_chats_organization_workflow_check',
      sql`${table.organizationId} IS NULL OR ${table.workflowId} IS NULL`
    ),
    userOrganizationCreatedIdx: index('copilot_chats_user_org_created_idx').on(
      table.userId,
      table.organizationId,
      table.createdAt,
      table.id
    ),
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

    // Soft-deleted chats surfaced in Recently Deleted (listed per user + workspace)
    userWorkspaceDeletedPartialIdx: index('copilot_chats_user_workspace_deleted_partial_idx')
      .on(table.userId, table.workspaceId)
      .where(sql`${table.deletedAt} IS NOT NULL`),
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

export const copilotToolPermissionDecisionEnum = pgEnum('copilot_tool_permission_decision', [
  'allow',
  'allow_chat',
  'always_allow',
  'skip',
])

export type CopilotRunStatus = (typeof copilotRunStatusEnum.enumValues)[number]
export type CopilotAsyncToolStatus = (typeof copilotAsyncToolStatusEnum.enumValues)[number]
export type CopilotToolPermissionDecision =
  (typeof copilotToolPermissionDecisionEnum.enumValues)[number]

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
    // Set only for tools declaring requiresApproval in the mothership tool
    // catalog. A null decision on such a tool means the prompt is still
    // outstanding, which is what lets it survive a reload.
    permissionDecision: copilotToolPermissionDecisionEnum('permission_decision'),
    permissionDecidedAt: timestamp('permission_decided_at'),
    claimedAt: timestamp('claimed_at'),
    claimedBy: text('claimed_by'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    runIdIdx: index('copilot_async_tool_calls_run_id_idx').on(table.runId),
    checkpointIdIdx: index('copilot_async_tool_calls_checkpoint_id_idx').on(table.checkpointId),
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

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    credentialGroupId: text('credential_group_id').references(
      (): AnyPgColumn => credentialGroup.id,
      { onDelete: 'set null' }
    ),
    managedConnectorId: text('managed_connector_id'),
    oauthConfigVersion: integer('oauth_config_version').notNull().default(1),

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
    ownerCheck: check(
      'mcp_servers_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationManagedCheck: check(
      'mcp_servers_organization_managed_check',
      sql`${table.organizationId} IS NULL OR ${table.credentialGroupId} IS NOT NULL`
    ),
    organizationIdx: index('mcp_servers_organization_id_idx').on(table.organizationId),
    // Primary access pattern - active servers by workspace
    workspaceEnabledIdx: index('mcp_servers_workspace_enabled_idx').on(
      table.workspaceId,
      table.enabled
    ),
    credentialGroupIdx: index('mcp_servers_credential_group_idx').on(table.credentialGroupId),
    credentialGroupManagedConnectorUnique: uniqueIndex(
      'mcp_servers_credential_group_managed_connector_unique'
    )
      .on(table.credentialGroupId, table.managedConnectorId)
      .where(
        sql`${table.credentialGroupId} IS NOT NULL AND ${table.managedConnectorId} IS NOT NULL AND ${table.deletedAt} IS NULL`
      ),
    credentialGroupManagedConnectorCheck: check(
      'mcp_servers_credential_group_managed_connector_check',
      sql`${table.credentialGroupId} IS NULL OR ${table.managedConnectorId} IS NOT NULL`
    ),
    managedConnectorOauthCheck: check(
      'mcp_servers_managed_connector_oauth_check',
      sql`${table.managedConnectorId} IS NULL OR ${table.authType} = 'oauth'`
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
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

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
    ownerCheck: check(
      'mcp_server_oauth_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
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
    /**
     * Better Auth's SSO `domainVerification` flag. Sim proves ownership itself
     * via {@link ssoDomain} before registration, so this mirrors that decision
     * rather than driving a second flow. It makes Better Auth treat the provider
     * as authoritative for its domain and auto-link same-email accounts; without
     * it, IdPs omitting `email_verified` (notably Entra) strand those users.
     * Defaults to true so pre-existing providers keep signing in across deploy.
     */
    domainVerified: boolean('domain_verified').notNull().default(true),
    /**
     * Whether a successful SSO sign-in may provision a new organization
     * membership. Sim owns this admission path so seat checks, billing effects,
     * session policy, and audit all use the same transaction as every other join.
     * Defaults to true to preserve existing providers during a rolling deploy.
     */
    jitProvisioningEnabled: boolean('jit_provisioning_enabled').notNull().default(true),
  },
  (table) => ({
    // Better Auth resolves providers by `providerId` alone (no org scoping), so
    // a duplicate makes registration and updates ambiguous across tenants.
    providerIdUnique: uniqueIndex('sso_provider_provider_id_unique').on(table.providerId),
    domainIdx: index('sso_provider_domain_idx').on(table.domain),
    userIdIdx: index('sso_provider_user_id_idx').on(table.userId),
    organizationIdIdx: index('sso_provider_organization_id_idx').on(table.organizationId),
  })
)

/**
 * An email domain an organization has claimed, and its verification state.
 *
 * A domain must be **verified** (via a DNS TXT challenge — the org places
 * `verificationToken` in a `_sim-challenge.<domain>` record) before it can be
 * configured for single sign-on: verifying proves the org controls the domain,
 * which is the security precondition for wiring it to an identity provider.
 * Existing `sso_provider` domains are grandfathered as `verified` by the
 * backfill in migration 0266.
 */
export const ssoDomain = pgTable(
  'sso_domain',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Normalized (lowercase, registrable) domain — see `normalizeSSODomain`. */
    domain: text('domain').notNull(),
    /** `'pending'` until the DNS TXT record is observed, then `'verified'`. */
    status: text('status').notNull().default('pending'),
    /** High-entropy token placed in the domain's `_sim-challenge` TXT record. */
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index('sso_domain_organization_id_idx').on(table.organizationId),
    domainIdx: index('sso_domain_domain_idx').on(table.domain),
    /**
     * An org holds at most one row per domain. Makes claims idempotent under
     * concurrency: two admins racing to add the same domain cannot create
     * duplicate pending rows — the second insert hits this constraint.
     */
    orgDomainUnique: uniqueIndex('sso_domain_org_domain_unique').on(
      table.organizationId,
      table.domain
    ),
    /**
     * A verified domain is globally unique — exactly one org owns it. Pending
     * rows may coexist (multiple orgs can race to prove ownership), so the
     * constraint is a partial unique index scoped to verified rows.
     */
    verifiedDomainUnique: uniqueIndex('sso_domain_verified_unique')
      .on(table.domain)
      .where(sql`status = 'verified'`),
  })
)

/**
 * OAuth 2.0 provider tables (Better Auth `@better-auth/oauth-provider`).
 *
 * Sim is the authorization server: a registered client (the Sim CLI, or an
 * admin-created third-party app) sends a user through `/api/auth/oauth2/authorize`,
 * the user consents, and the client redeems a code for an opaque access token and
 * a rotating refresh token. Tokens are stored hashed; the plaintext exists only in
 * the client. Column keys follow the plugin's model fields so the Better Auth
 * drizzle adapter maps them without a per-field `fieldName` override.
 */
export const oauthClient = pgTable(
  'oauth_client',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    disabled: boolean('disabled').notNull().default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    public: boolean('public'),
    type: text('type'),
    requirePKCE: boolean('require_pkce'),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
  },
  (table) => ({
    userIdIdx: index('oauth_client_user_id_idx').on(table.userId),
  })
)

/** The scopes a user has granted a client; deleted when the user revokes the app. */
export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    clientIdIdx: index('oauth_consent_client_id_idx').on(table.clientId),
    /** One grant per user, client, and reference, including nullable dimensions. */
    userClientUnique: unique('oauth_consent_user_client_reference_unique')
      .on(table.userId, table.clientId, table.referenceId)
      .nullsNotDistinct(),
  })
)

/**
 * One independently revocable login. Every rotating refresh token belongs to
 * a stable family so replay and logout can atomically remove all descendants.
 */
export const oauthTokenFamily = pgTable(
  'oauth_token_family',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    consentId: text('consent_id').references(() => oauthConsent.id, { onDelete: 'cascade' }),
    currentGeneration: integer('current_generation').notNull().default(0),
    createdAt: timestamp('created_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => ({
    clientIdIdx: index('oauth_token_family_client_id_idx').on(table.clientId),
    sessionIdIdx: index('oauth_token_family_session_id_idx').on(table.sessionId),
    userClientIdx: index('oauth_token_family_user_client_idx').on(table.userId, table.clientId),
    consentIdIdx: index('oauth_token_family_consent_id_idx').on(table.consentId),
    expiresAtIdx: index('oauth_token_family_expires_at_idx').on(table.expiresAt),
    generationCheck: check(
      'oauth_token_family_generation_check',
      sql`${table.currentGeneration} BETWEEN 0 AND 1000`
    ),
  })
)

/** A member of a rotating refresh-token family. */
export const oauthRefreshToken = pgTable(
  'oauth_refresh_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    revoked: timestamp('revoked'),
    authTime: timestamp('auth_time'),
    scopes: text('scopes').array().notNull(),
    resource: text('resource'),
    familyId: text('family_id')
      .notNull()
      .references(() => oauthTokenFamily.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
  },
  (table) => ({
    clientIdIdx: index('oauth_refresh_token_client_id_idx').on(table.clientId),
    sessionIdIdx: index('oauth_refresh_token_session_id_idx').on(table.sessionId),
    userClientIdx: index('oauth_refresh_token_user_client_idx').on(table.userId, table.clientId),
    /** Drives the cleanup pass; nothing else reads tokens by expiry. */
    expiresAtIdx: index('oauth_refresh_token_expires_at_idx').on(table.expiresAt),
    familyGenerationUnique: unique('oauth_refresh_token_family_generation_unique').on(
      table.familyId,
      table.generation
    ),
    generationCheck: check(
      'oauth_refresh_token_generation_check',
      sql`${table.generation} BETWEEN 0 AND 1000`
    ),
    /** contract-pending(after #7613 is fully deployed): validate oauth_refresh_token_search_resource_check separately so rollout avoids a token-table scan. */
    searchResourceCheck: check(
      'oauth_refresh_token_search_resource_check',
      sql`NOT ('search:read' = ANY(${table.scopes})) OR ${table.resource} IS NOT NULL`
    ),
  })
)

/** An opaque access token, looked up by hash on every bearer-authenticated request. */
export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    scopes: text('scopes').array().notNull(),
    resource: text('resource'),
  },
  (table) => ({
    clientIdIdx: index('oauth_access_token_client_id_idx').on(table.clientId),
    sessionIdIdx: index('oauth_access_token_session_id_idx').on(table.sessionId),
    refreshIdIdx: index('oauth_access_token_refresh_id_idx').on(table.refreshId),
    userClientIdx: index('oauth_access_token_user_client_idx').on(table.userId, table.clientId),
    /** Drives the cleanup pass; nothing else reads tokens by expiry. */
    expiresAtIdx: index('oauth_access_token_expires_at_idx').on(table.expiresAt),
    /** contract-pending(after #7613 is fully deployed): validate oauth_access_token_search_resource_check separately so rollout avoids a token-table scan. */
    searchResourceCheck: check(
      'oauth_access_token_search_resource_check',
      sql`NOT ('search:read' = ANY(${table.scopes})) OR ${table.resource} IS NOT NULL`
    ),
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
    /**
     * The publisher's org-wide decision on whether this block's runs are joined into
     * a consumer's trace. It is the ONLY policy — no viewer check runs downstream —
     * so turning it on publishes the source workflow's block names, inputs, outputs,
     * and prompts to anyone who can read a consuming workflow's logs, including
     * consumers with no access to the source workspace.
     *
     * Defaults false because of that: this is the same boundary curated outputs and
     * redacted errors exist to hold, and it may only open by an affirmative act of
     * the publisher, never by a column default applied to rows nobody revisited.
     */
    traceChildRuns: boolean('trace_child_runs').notNull().default(false),
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

/**
 * `model_unbilled` records model usage Sim does not charge for — a call funded by
 * the customer's own provider key (BYOK). Its `cost` is always `0` and its value is
 * the token counts in `metadata`, so the org usage panel can report volume the
 * billing ledger has no reason to know about.
 *
 * It is deliberately a distinct category rather than a `category = 'model'` row with
 * `cost = 0`: every existing and future `where category = 'model'` billing query
 * stays blind to these rows unless it opts in.
 */
export const usageLogCategoryEnum = pgEnum('usage_log_category', [
  'model',
  'fixed',
  'tool',
  'model_unbilled',
])
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
  'voice-output',
  'api-tool',
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
    /**
     * Covering companion to `billingEntityPeriodIdx` — not a replacement. Carries
     * `cost` so the billing-period aggregates resolve index-only rather than taking
     * a heap fetch per matched row.
     *
     * `userId`/`createdAt` sit immediately after the shared equality prefix because
     * the weekly-refresh rollup filters on them and NOT on `billingPeriodEnd`;
     * putting `billingPeriodEnd` in that slot would end the usable prefix at
     * `billingPeriodStart` and leave that query scanning the whole period.
     * `billingPeriodEnd` is functionally determined by `billingPeriodStart`, so it
     * removes no rows and rides along as payload.
     *
     * `billingEntityPeriodIdx` is kept deliberately: with no high-cardinality key
     * column it deduplicates to a fraction of this index's size, which keeps
     * prefix-only bitmap scans cheap.
     */
    billingPeriodCostIdx: index('usage_log_billing_period_cost_idx')
      .on(
        table.billingEntityType,
        table.billingEntityId,
        table.billingPeriodStart,
        table.userId,
        table.createdAt,
        table.billingPeriodEnd,
        table.source,
        table.cost
      )
      .where(sql`${table.billingEntityType} IS NOT NULL`),
    billingEntityCreatedAtCostIdx: index('usage_log_billing_entity_created_at_cost_idx')
      .on(
        table.billingEntityType,
        table.billingEntityId,
        table.createdAt,
        table.userId,
        table.source,
        table.cost
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
  'managed_oauth',
  'managed_mcp',
  'env_workspace',
  'env_personal',
  'service_account',
  'personal_token',
])

export const managedOauthCredentialStatusEnum = pgEnum('managed_oauth_credential_status', [
  'active',
  'needs_reauth',
  'revoked',
])

export interface ManagedOAuthProviderMetadata {
  email: string
  displayName?: string
  avatarUrl?: string
  username?: string
  tenantDisplayName?: string
}

export interface ManagedMcpToolSnapshot {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

/** contract-pending(after all GitLab tokens migrate and workspace-token writers are retired): drop credential_personal_token_identity_unique; only the index is retired. */
export const credential = pgTable(
  'credential',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    type: credentialTypeEnum('type').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    /**
     * Opts an env_workspace secret out of resolved-secret redaction: its value renders in
     * plaintext across surfaces (logs, model-visible content, sandbox file exports) instead
     * of `{{NAME}}`, and is not recorded into durable provenance. Meaningful only for
     * type = 'env_workspace'; writes for other types are rejected in the orchestration layer.
     */
    unredacted: boolean('unredacted').notNull().default(false),
    providerId: text('provider_id'),
    accountId: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
    envKey: text('env_key'),
    envOwnerUserId: text('env_owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    encryptedServiceAccountKey: text('encrypted_service_account_key'),
    /** Encrypted provider token bound immutably to createdBy, providerSubjectId, and providerTenantId. */
    encryptedPersonalToken: text('encrypted_personal_token'),
    authorizationAppId: text('authorization_app_id'),
    credentialGroupEnrollmentId: text('credential_group_enrollment_id').references(
      (): AnyPgColumn => credentialGroupEnrollment.id,
      { onDelete: 'cascade' }
    ),
    credentialGroupOptionId: text('credential_group_option_id'),
    mcpServerId: text('mcp_server_id').references(() => mcpServers.id, {
      onDelete: 'cascade',
    }),
    mcpOauthConfigVersion: integer('mcp_oauth_config_version'),
    managedOauthScopeVersion: integer('managed_oauth_scope_version'),
    providerSubjectId: text('provider_subject_id'),
    providerTenantId: text('provider_tenant_id'),
    managedOauthStatus: managedOauthCredentialStatusEnum('managed_oauth_status'),
    grantedScopes: text('granted_scopes').array(),
    providerMetadata: jsonb('provider_metadata').$type<ManagedOAuthProviderMetadata>(),
    encryptedOauthTokenSet: text('encrypted_oauth_token_set'),
    mcpTools: jsonb('mcp_tools').$type<ManagedMcpToolSnapshot[]>(),
    mcpToolsRefreshedAt: timestamp('mcp_tools_refreshed_at'),
    grantedAt: timestamp('granted_at'),
    revokedAt: timestamp('revoked_at'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    lastRefreshedAt: timestamp('last_refreshed_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'credential_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdIdx: index('credential_organization_id_idx').on(table.organizationId),
    organizationTypeCheck: check(
      'credential_organization_type_check',
      sql`${table.organizationId} IS NULL OR ${table.type} IN ('oauth', 'managed_oauth', 'managed_mcp', 'service_account', 'personal_token')`
    ),
    organizationAccountUnique: uniqueIndex('credential_organization_account_unique')
      .on(table.organizationId, table.accountId)
      .where(sql`${table.accountId} IS NOT NULL`),
    organizationPersonalTokenUnique: uniqueIndex('credential_org_personal_token_unique')
      .on(
        table.organizationId,
        table.createdBy,
        table.providerId,
        table.providerTenantId,
        table.providerSubjectId
      )
      .where(sql`${table.type} = 'personal_token'`),
    workspaceIdIdx: index('credential_workspace_id_idx').on(table.workspaceId),
    typeIdx: index('credential_type_idx').on(table.type),
    providerIdIdx: index('credential_provider_id_idx').on(table.providerId),
    accountIdIdx: index('credential_account_id_idx').on(table.accountId),
    envOwnerUserIdIdx: index('credential_env_owner_user_id_idx').on(table.envOwnerUserId),
    credentialGroupEnrollmentIdx: index('credential_group_enrollment_idx').on(
      table.credentialGroupEnrollmentId
    ),
    mcpServerIdx: index('credential_mcp_server_idx').on(table.mcpServerId),
    credentialGroupOptionUnique: uniqueIndex('credential_group_option_unique')
      .on(table.credentialGroupEnrollmentId, table.credentialGroupOptionId)
      .where(sql`${table.type} = 'managed_oauth'`),
    managedMcpEnrollmentServerUnique: uniqueIndex('credential_managed_mcp_enrollment_server_unique')
      .on(table.credentialGroupEnrollmentId, table.mcpServerId)
      .where(sql`${table.type} = 'managed_mcp'`),
    workspaceAccountUnique: uniqueIndex('credential_workspace_account_unique')
      .on(table.workspaceId, table.accountId)
      .where(sql`account_id IS NOT NULL`),
    workspaceEnvUnique: uniqueIndex('credential_workspace_env_unique')
      .on(table.workspaceId, table.type, table.envKey)
      .where(sql`type = 'env_workspace'`),
    workspacePersonalEnvUnique: uniqueIndex('credential_workspace_personal_env_unique')
      .on(table.workspaceId, table.type, table.envKey, table.envOwnerUserId)
      .where(sql`type = 'env_personal'`),
    personalTokenIdentityUnique: uniqueIndex('credential_personal_token_identity_unique')
      .on(
        table.workspaceId,
        table.createdBy,
        table.providerId,
        table.providerTenantId,
        table.providerSubjectId
      )
      .where(sql`type = 'personal_token'`),
    personalTokenSourceConstraint: check(
      'credential_personal_token_source_check',
      sql`(type::text <> 'personal_token') OR (
        created_by IS NOT NULL
        AND provider_id IS NOT NULL
        AND provider_id = 'gitlab'
        AND provider_subject_id IS NOT NULL
        AND provider_tenant_id IS NOT NULL
        AND encrypted_personal_token IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND cardinality(granted_scopes) > 0
        AND account_id IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND authorization_app_id IS NULL
        AND encrypted_oauth_token_set IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )`
    ),
    oauthSourceConstraint: check(
      'credential_oauth_source_check',
      sql`(type <> 'oauth') OR (account_id IS NOT NULL AND provider_id IS NOT NULL)`
    ),
    managedOauthSourceConstraint: check(
      'credential_managed_oauth_source_check',
      sql`(type::text <> 'managed_oauth') OR (
        account_id IS NULL
        AND provider_id IS NOT NULL
        AND authorization_app_id IS NOT NULL
        AND provider_subject_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND encrypted_oauth_token_set IS NOT NULL
        AND granted_at IS NOT NULL
      )`
    ),
    managedOauthGroupBindingConstraint: check(
      'credential_managed_oauth_group_binding_check',
      sql`(type::text <> 'managed_oauth') OR (
        credential_group_enrollment_id IS NOT NULL
        AND credential_group_option_id IS NOT NULL
        AND managed_oauth_scope_version IS NOT NULL
        AND managed_oauth_scope_version > 0
      )`
    ),
    managedMcpSourceConstraint: check(
      'credential_managed_mcp_source_check',
      sql`(type::text <> 'managed_mcp') OR (
        id LIKE 'mcp-cg-%'
        AND account_id IS NULL
        AND provider_id IS NULL
        AND authorization_app_id IS NULL
        AND credential_group_enrollment_id IS NOT NULL
        AND credential_group_option_id IS NULL
        AND mcp_server_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND (managed_oauth_status <> 'active' OR (
          encrypted_oauth_token_set IS NOT NULL
          AND mcp_tools IS NOT NULL
        ))
        AND granted_at IS NOT NULL
        AND managed_oauth_scope_version IS NULL
        AND provider_subject_id IS NULL
        AND provider_tenant_id IS NULL
        AND granted_scopes IS NULL
        AND provider_metadata IS NULL
        AND created_by IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )`
    ),
    creatorSourceConstraint: check(
      'credential_creator_source_check',
      sql`(type::text = 'managed_mcp') OR created_by IS NOT NULL`
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

export const credentialGroupStatusEnum = pgEnum('credential_group_status', ['active', 'disabled'])

export interface CredentialGroupOptionConfig {
  id: string
  provider: string
  label: string
  slackBotCredentialId?: string
  authorizationAppId: string
  requiredScopes: string[]
  scopeVersion: number
  required: boolean
  status: 'active' | 'disabled'
}

/** Singleton configuration for collecting an organization's connected accounts. */
export const credentialGroup = pgTable(
  'credential_group',
  {
    id: text('id').primaryKey(),
    /** contract-pending(org connected accounts fully deployed and legacy Search migrated): remove workspace ownership. */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    publicId: text('public_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    options: jsonb('options').$type<CredentialGroupOptionConfig[]>().notNull(),
    encryptedProviderConfiguration: text('encrypted_provider_configuration'),
    status: credentialGroupStatusEnum('status').notNull().default('active'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'credential_group_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdIdx: index('credential_group_organization_id_idx').on(table.organizationId),
    organizationUnique: uniqueIndex('credential_group_organization_unique').on(
      table.organizationId
    ),
    publicIdUnique: uniqueIndex('credential_group_public_id_unique').on(table.publicId),
    workspaceUnique: uniqueIndex('credential_group_workspace_unique').on(table.workspaceId),
  })
)

export const credentialGroupEnrollmentStatusEnum = pgEnum('credential_group_enrollment_status', [
  'invited',
  'delivery_failed',
  'in_progress',
  'completed',
  'revoked',
])

/** Email-bound invitation and resumable progress for one credential-group recipient. */
export const credentialGroupEnrollment = pgTable(
  'credential_group_enrollment',
  {
    id: text('id').primaryKey(),
    credentialGroupId: text('credential_group_id')
      .notNull()
      .references(() => credentialGroup.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** Bound once after the invitee signs in with the verified invitation email. */
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    status: credentialGroupEnrollmentStatusEnum('status').notNull().default('invited'),
    invitationTokenHash: text('invitation_token_hash').notNull(),
    invitationExpiresAt: timestamp('invitation_expires_at').notNull(),
    invitedAt: timestamp('invited_at').notNull(),
    sentAt: timestamp('sent_at'),
    completedAt: timestamp('completed_at'),
    revokedAt: timestamp('revoked_at'),
    lastDeliveryError: text('last_delivery_error'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    groupUserUnique: uniqueIndex('credential_group_enrollment_group_user_unique')
      .on(table.credentialGroupId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    userIdx: index('credential_group_enrollment_user_id_idx').on(table.userId),
    groupEmailUnique: uniqueIndex('credential_group_enrollment_group_email_unique').on(
      table.credentialGroupId,
      table.email
    ),
    invitationTokenHashUnique: uniqueIndex(
      'credential_group_enrollment_invitation_token_hash_unique'
    ).on(table.invitationTokenHash),
    groupStatusIdx: index('credential_group_enrollment_group_status_idx').on(
      table.credentialGroupId,
      table.status
    ),
    groupInvitedAtIdIdx: index('credential_group_enrollment_group_invited_at_id_idx').on(
      table.credentialGroupId,
      table.invitedAt,
      table.id
    ),
    normalizedEmail: check(
      'credential_group_enrollment_normalized_email_check',
      sql`${table.email} = lower(btrim(${table.email})) AND length(${table.email}) BETWEEN 3 AND 320`
    ),
    invitationTokenHashLength: check(
      'credential_group_enrollment_invitation_token_hash_length_check',
      sql`length(${table.invitationTokenHash}) = 64`
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
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    providerId: text('provider_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    credentialId: text('credential_id').references(() => credential.id, { onDelete: 'cascade' }),
    oauthConfig: text('oauth_config'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'pending_draft_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdIdx: index('pending_draft_organization_id_idx').on(table.organizationId),
    uniqueOrganizationDraft: uniqueIndex('pending_draft_user_provider_org').on(
      table.userId,
      table.providerId,
      table.organizationId
    ),
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
    /**
     * How an empty non-default group behaves.
     *
     * `inherit` (the default, and every pre-existing group) keeps the member
     * invariant above: no member rows means the group governs every member of
     * its workspaces. `explicit` means the group governs exactly its member
     * rows and therefore governs nobody when empty.
     *
     * Directory-managed groups must be `explicit`. Under `inherit`, an identity
     * provider removing the last member would silently widen the group from
     * "these three people" to "everyone in these workspaces" — the opposite of
     * what the administrator asked for.
     */
    membershipMode: text('membership_mode').notNull().default('inherit'),
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

/** Versioned statement policy attached to one canonical workspace or organization resource. */
export const resourcePolicy = pgTable(
  'resource_policy',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    revision: integer('revision').notNull().default(1),
    document: jsonb('document').$type<unknown>().notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'resource_policy_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdx: index('resource_policy_organization_id_idx').on(table.organizationId),
    resourceUnique: uniqueIndex('resource_policy_resource_unique').on(
      table.resourceType,
      table.resourceId
    ),
    workspaceIdx: index('resource_policy_workspace_id_idx').on(table.workspaceId),
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
    scheduleUnreconciledTerminalIdx: index('async_jobs_schedule_unreconciled_terminal_idx')
      .on(table.updatedAt, table.id)
      .where(
        sql`${table.type} = 'schedule-execution' AND ${table.status} IN ('completed', 'failed', 'cancelled') AND COALESCE(${table.metadata} ->> 'scheduleReconciled', 'false') <> 'true'`
      ),
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
    /**
     * The credential used to index content. In members mode it is optional:
     * NULL indexes the union of members' listings; a dedicated credential
     * indexes content while members only establish document visibility. Not yet a
     * foreign key: rows written before the `credential` table existed may
     * still hold a raw `account.id`, which script migration 0011 remaps.
     * contract-pending(after 0011 has run in production): add the reference to
     * `credential.id` with ON DELETE SET NULL and remove the raw account-id
     * fallback in lib/oauth/credential-service.ts.
     */
    credentialId: text('credential_id'),
    encryptedApiKey: text('encrypted_api_key'),
    sourceConfig: json('source_config').notNull(),
    syncMode: text('sync_mode').notNull().default('full'),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(1440),
    /**
     * How document access is derived. `workspace`: every synced document is
     * `{ws}`. `members`: a document's ACL is the members whose own listing
     * returned it, optionally with a dedicated credential for content.
     * `admin`: source permissions and identity groups are mirrored independently
     * of content changes.
     */
    accessMode: text('access_mode').notNull().default('workspace'),
    /** Members mode: the credential group whose option supplies the member credentials. */
    credentialGroupId: text('credential_group_id').references(() => credentialGroup.id, {
      onDelete: 'set null',
    }),
    /** Members mode: the option within the group; must map to this connector's provider. */
    credentialGroupOptionId: text('credential_group_option_id'),
    /**
     * Members-mode run state. Mirrors `status` for the content engine but is
     * independent of it: the two engines never run for the same connector
     * (`kc_sync_lock_exclusive_check`), yet share no columns so neither can
     * misread the other's lease.
     */
    memberSyncStatus: text('member_sync_status').notNull().default('idle'),
    memberSyncLockToken: text('member_sync_lock_token'),
    memberSyncLockLeaseAt: timestamp('member_sync_lock_lease_at'),
    nextMemberSyncAt: timestamp('next_member_sync_at'),
    lastMemberSyncAt: timestamp('last_member_sync_at'),
    lastMemberSyncError: text('last_member_sync_error'),
    memberSyncConsecutiveFailures: integer('member_sync_consecutive_failures').notNull().default(0),
    /**
     * Set by a mode switch whose ACL rewrite exceeded the request budget; the
     * member-sync job finishes the rewrite before the mode takes effect.
     */
    accessRewritePending: boolean('access_rewrite_pending').notNull().default(false),
    /**
     * One of `active`, `pending`, `syncing`, `error`, `paused`, `disabled`.
     *
     * `pending` and `syncing` are the two halves of a sync in flight: `pending`
     * is written as the sync is handed to the queue, `syncing` when a worker
     * takes the lock. The split exists because the queue depth between them is
     * unbounded — without `pending` the row is indistinguishable from idle for
     * as long as the hand-off takes, which is what forced readers to guess from
     * `created_at`. A row left `pending` past the lock TTL is reclaimed by the
     * scheduler, which is the only thing that ever observes a lost hand-off.
     */
    status: text('status').notNull().default('active'),
    lastSyncAt: timestamp('last_sync_at'),
    lastSyncError: text('last_sync_error'),
    lastSyncDocCount: integer('last_sync_doc_count'),
    /** Durable content-listing progress; contains cursors and counters, never credentials. */
    listingCheckpoint: jsonb('listing_checkpoint').$type<Record<string, unknown>>(),
    /** Member account enumeration resumes independently of the content listing. */
    directoryCheckpoint: jsonb('directory_checkpoint').$type<Record<string, unknown>>(),
    nextSyncAt: timestamp('next_sync_at'),
    nextDirectorySyncAt: timestamp('next_directory_sync_at').notNull().defaultNow(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /**
     * Identifies the sync run that currently holds this connector's lock.
     *
     * `status = 'syncing'` only says *a* run holds it. After the scheduler
     * reclaims a stale lock and dispatches a replacement, the original run would
     * still see `syncing` and overwrite the replacement's state. Terminal writes
     * match this token so a run can prove the lock is still *its own*.
     */
    syncLockToken: text('sync_lock_token'),
    /**
     * When the run holding this connector's lock last proved it was alive.
     *
     * Split off `updated_at`, which the stale-lock reaper used to read as a
     * lease. `updated_at` is the row's modification time, so every unrelated
     * write — a config edit, a status change — renewed the lease of a wedged
     * run and pushed its recovery out by another full TTL. Only lock
     * acquisition and the heartbeat write this column; both terminal helpers
     * clear it alongside `sync_lock_token`.
     *
     * NULL on a row locked before this column existed, and on any future writer
     * that forgets it, so every reader compares `COALESCE(lease, updated_at)`
     * rather than the lease alone — a `lease <= cutoff` test is NULL-false and
     * would make such a row permanently unreclaimable.
     */
    syncLockLeaseAt: timestamp('sync_lock_lease_at'),
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
    /** Member-sync scheduler due sweep; partial so workspace-mode rows cost nothing. */
    memberSyncDueIdx: index('kc_member_sync_due_idx')
      .on(table.memberSyncStatus, table.nextMemberSyncAt)
      .where(sql`${table.accessMode} = 'members' AND ${table.deletedAt} IS NULL`),
    directorySyncDueIdx: index('kc_directory_sync_due_idx')
      .on(table.nextDirectorySyncAt, table.id)
      .where(sql`${table.accessMode} = 'admin' AND ${table.deletedAt} IS NULL`),
    accessModeCheck: check(
      'kc_access_mode_check',
      sql`${table.accessMode} IN ('workspace', 'members', 'admin')`
    ),
    memberSyncStatusCheck: check(
      'kc_member_sync_status_check',
      sql`${table.memberSyncStatus} IN ('idle', 'pending', 'running', 'error', 'disabled')`
    ),
    /** The content engine and the member engine are mutually exclusive on a connector. */
    syncLockExclusiveCheck: check(
      'kc_sync_lock_exclusive_check',
      sql`NOT (${table.syncLockToken} IS NOT NULL AND ${table.memberSyncLockToken} IS NOT NULL)`
    ),
  })
)

/**
 * One row per (members-mode connector, member credential). Membership is
 * derived from the credential-group option on every run: `active` while the
 * managed credential is usable and the enrollment live, `suspended` otherwise
 * (needs re-auth, enrollment revoked, option disabled). Suspension drops the
 * member's token from every ACL immediately but keeps their observations, so a
 * routine scope-version bump never wipes the observation graph. A row is
 * deleted only when the credential row is gone (cascade), the option no longer
 * references it, or it has stayed suspended past the purge window.
 */
export const knowledgeConnectorMember = pgTable(
  'knowledge_connector_member',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    connectorId: text('connector_id')
      .notNull()
      .references(() => knowledgeConnector.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id')
      .notNull()
      .references(() => credential.id, { onDelete: 'cascade' }),
    /**
     * Snapshot of the member's identity token, derived from the credential
     * row by `lib/knowledge/access/tokens.ts`. Reconciliation rewrites it and
     * rematerialises the member's documents if the credential's subject
     * changes.
     */
    subjectToken: text('subject_token').notNull(),
    /** `active`, `suspended`, or `disabled`. */
    status: text('status').notNull().default('active'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /**
     * When the member is next due. NULL means "with the connector's next run":
     * a member that completed on a manual-only connector. A new member is due
     * now. An explicit time that has passed is what keeps a connector
     * re-dispatching itself.
     */
    nextAttemptAt: timestamp('next_attempt_at'),
    lastStartedAt: timestamp('last_started_at'),
    /** Last listing that was full, complete, and not suspect — the only kind that may remove observations. */
    lastCompleteListingAt: timestamp('last_complete_listing_at'),
    lastListedCount: integer('last_listed_count'),
    lastError: text('last_error'),
    /** Authorization watermark: complete nonsuspect full listing or completely drained change feed. */
    memberSyncedThrough: timestamp('member_synced_through'),
    /**
     * Where the member's change feed resumes. Opened just before a full listing
     * and stored once that listing lands, so every later run reads the feed
     * instead of relisting; NULL when the connector has no feed or the feed
     * has to be reopened.
     */
    changeCursor: text('change_cursor'),
    /** Durable full-listing progress, separate from the provider's incremental change token. */
    listingCheckpoint: jsonb('listing_checkpoint').$type<Record<string, unknown>>(),
    suspendedAt: timestamp('suspended_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'kcm_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdIdx: index('kcm_organization_id_idx').on(table.organizationId),
    connectorCredentialUnique: uniqueIndex('kcm_connector_credential_unique').on(
      table.connectorId,
      table.credentialId
    ),
    /** Drain-loop claim order: due first (NULL = never gated), then least recently started. */
    connectorQueueIdx: index('kcm_connector_queue_idx').on(
      table.connectorId,
      table.nextAttemptAt.asc().nullsFirst(),
      table.lastStartedAt.asc().nullsFirst()
    ),
    credentialIdx: index('kcm_credential_idx').on(table.credentialId),
    statusCheck: check(
      'kcm_status_check',
      sql`${table.status} IN ('active', 'suspended', 'disabled')`
    ),
    subjectTokenShapeCheck: check(
      'kcm_subject_token_shape_check',
      sql`${table.subjectToken} ~ '^s:[^:]+:[^:]+:.+$'`
    ),
  })
)

/**
 * "Member M's crawl returned document D." A members-mode document's ACL is
 * exactly the subject tokens of its active observers; a document with no
 * observation of any status is tombstoned and, after the purge window, hard
 * deleted.
 */
export const knowledgeDocumentObservation = pgTable(
  'knowledge_document_observation',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => knowledgeConnectorMember.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    /** Member-sync run (`knowledge_connector_member_sync_log.id`) that last asserted this observation. */
    runId: text('run_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.documentId, table.memberId] }),
    /** Per-member removal after a complete listing, and the staleness sweep. */
    memberIdx: index('kdo_member_idx').on(table.memberId),
  })
)

/** Shared refresh ownership and complete-pass evidence for a workspace/provider/tenant directory. */
export const knowledgeExternalDirectory = pgTable(
  'knowledge_external_directory',
  {
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    providerId: text('provider_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    syncLockToken: text('sync_lock_token'),
    syncLockLeaseAt: timestamp('sync_lock_lease_at'),
    /** A newer attempt invalidates cached completion until that whole pass succeeds. */
    lastStartedAt: timestamp('last_started_at'),
    /** Complete directory enumeration, including empty directories; independent of individual group freshness. */
    lastCompleteSyncAt: timestamp('last_complete_sync_at'),
  },
  (table) => ({
    ownerCheck: check(
      'ked_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdIdx: index('ked_organization_id_idx').on(table.organizationId),
    workspaceIdentity: uniqueIndex('ked_workspace_identity_unique').on(
      table.workspaceId,
      table.providerId,
      table.tenantId
    ),
    organizationIdentity: uniqueIndex('ked_organization_identity_unique').on(
      table.organizationId,
      table.providerId,
      table.tenantId
    ),
  })
)

/**
 * A group in an external directory, as an admin-mode crawl names it.
 *
 * Scoped by workspace, provider and tenant rather than by connector: two Drive
 * connectors over the same Google Workspace domain grant the same groups, and
 * resolving that domain's directory once per connector would multiply the
 * Admin SDK traffic by the number of knowledge bases.
 *
 * `externalGroupId` is whatever the source's permissions API names a group by —
 * a group email in Drive, a group id in Confluence — canonicalised by
 * `canonicalGroupId`, exactly as `groupToken` spells it. Keying the directory
 * by the same identifier the grant carries is what lets a token resolve to
 * membership with no lookup in between.
 */
export const knowledgeExternalGroup = pgTable(
  'knowledge_external_group',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id'),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    /** Matches the provider segment of the `g:` token, e.g. `google-drive`. */
    providerId: text('provider_id').notNull(),
    /** The directory this group belongs to: a Workspace domain for Google, a site's cloud id for Confluence. */
    tenantId: text('tenant_id').notNull(),
    externalGroupId: text('external_group_id').notNull(),
    /**
     * When this group's membership was last enumerated in full, and the only
     * thing that decides whether it still grants access.
     *
     * A failed or partial enumeration writes nothing at all — not the
     * membership, not this column — which is what makes a transient directory
     * outage harmless. It is also why the column has to exist: without an age
     * bound, a group whose sync stopped running would keep granting forever
     * from membership nobody has checked since. A group unconfirmed for longer
     * than `EXTERNAL_GROUP_STALE_AFTER_MS` grants nothing.
     */
    lastSyncedAt: timestamp('last_synced_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: check(
      'keg_owner_check',
      sql`num_nonnulls(${table.workspaceId}, ${table.organizationId}) = 1`
    ),
    organizationIdIdx: index('keg_organization_id_idx').on(table.organizationId),
    organizationIdentityUnique: uniqueIndex('keg_organization_identity_unique').on(
      table.organizationId,
      table.providerId,
      table.tenantId,
      table.externalGroupId
    ),
    organizationSyncedIdx: index('keg_organization_synced_idx').on(
      table.organizationId,
      table.lastSyncedAt.asc().nullsFirst()
    ),
    /** Named explicitly: drizzle's derived name exceeds Postgres's 63-character limit and would be silently truncated. */
    workspaceFk: foreignKey({
      name: 'keg_workspace_fk',
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete('cascade'),
    identityUnique: uniqueIndex('keg_identity_unique').on(
      table.workspaceId,
      table.providerId,
      table.tenantId,
      table.externalGroupId
    ),
    /** The read path's freshness filter: a workspace's groups confirmed within the staleness window. */
    workspaceSyncedIdx: index('keg_workspace_synced_idx').on(
      table.workspaceId,
      table.lastSyncedAt.asc().nullsFirst()
    ),
  })
)

/**
 * External group membership keyed by canonical identity tokens: verified
 * addresses (`u:`) or provider account identities (`s:`). Provider identities
 * preserve permissions when a directory hides email addresses. Nested groups
 * are flattened by directory sync, without requiring members to have Sim accounts.
 */
export const knowledgeExternalGroupMember = pgTable(
  'knowledge_external_group_member',
  {
    groupId: text('group_id').notNull(),
    /** Includes `u:*@<domain>` for directory-wide grants; source account IDs retain their case. */
    subjectToken: text('subject_token').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.subjectToken] }),
    /** Named explicitly: drizzle's derived name exceeds Postgres's 63-character limit and would be silently truncated. */
    groupFk: foreignKey({
      name: 'kegm_group_fk',
      columns: [table.groupId],
      foreignColumns: [knowledgeExternalGroup.id],
    }).onDelete('cascade'),
    /** The read path: every group matching the actor's verified identities. */
    subjectTokenIdx: index('kegm_subject_token_idx').on(table.subjectToken),
  })
)

/**
 * Audit trail for members-mode runs; the content sync log is untouched. The
 * row id doubles as the run's lease token so the scheduler can tell an
 * orphaned `started` row from one a live run still holds.
 */
export const knowledgeConnectorMemberSyncLog = pgTable(
  'knowledge_connector_member_sync_log',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => knowledgeConnector.id, { onDelete: 'cascade' }),
    /** `started`, `completed`, or `failed`. */
    status: text('status').notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    membersClaimed: integer('members_claimed').notNull().default(0),
    membersCompleted: integer('members_completed').notNull().default(0),
    membersIncomplete: integer('members_incomplete').notNull().default(0),
    membersFailed: integer('members_failed').notNull().default(0),
    docsListed: integer('docs_listed').notNull().default(0),
    docsAdded: integer('docs_added').notNull().default(0),
    docsUpdated: integer('docs_updated').notNull().default(0),
    docsUnchanged: integer('docs_unchanged').notNull().default(0),
    docsHydratedOnce: integer('docs_hydrated_once').notNull().default(0),
    observationsAdded: integer('observations_added').notNull().default(0),
    observationsRemoved: integer('observations_removed').notNull().default(0),
    docsTombstoned: integer('docs_tombstoned').notNull().default(0),
    docsResurrected: integer('docs_resurrected').notNull().default(0),
    docsPurged: integer('docs_purged').notNull().default(0),
    credentialsAudited: integer('credentials_audited').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => ({
    connectorStartedAtIdx: index('kcmsl_connector_started_at_idx').on(
      table.connectorId,
      sql`${table.startedAt} DESC`
    ),
    /** Scheduler sweep for orphaned `started` rows; see `kcsl_started_at_partial_idx`. */
    startedPartialIdx: index('kcmsl_started_at_partial_idx')
      .on(table.startedAt)
      .where(sql`${table.status} = 'started'`),
    statusCheck: check(
      'kcmsl_status_check',
      sql`${table.status} IN ('started', 'partial', 'completed', 'failed')`
    ),
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
    docsSkipped: integer('docs_skipped').notNull().default(0),
    docsFailed: integer('docs_failed').notNull().default(0),
    /** Complete listing-cycle size; per-worker counters may cover only its last page batch. */
    listedCount: integer('listed_count'),
    errorMessage: text('error_message'),
  },
  (table) => ({
    connectorStartedAtIdx: index('kcsl_connector_started_at_idx').on(
      table.connectorId,
      sql`${table.startedAt} DESC`
    ),
    /**
     * Serves the scheduler's five-minute sweep for orphaned `started` rows.
     *
     * This table is append-only and never pruned, and `connector_id` does not
     * help a scan that filters on status and age, so the sweep was a sequential
     * scan of all sync history on every tick. The predicate is partial rather
     * than a composite `(status, started_at)`: `started` rows are a vanishing
     * fraction of the table and the only ones the sweep ever reads, so indexing
     * closed history buys nothing and costs write amplification on every
     * completion.
     */
    startedPartialIdx: index('kcsl_started_at_partial_idx')
      .on(table.startedAt)
      .where(sql`${table.status} = 'started'`),
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
    folderId: text('folder_id').references(() => folder.id, { onDelete: 'set null' }),
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
    /**
     * @remarks
     * Per-table mutation locks. Each guards one mutation verb; an admin toggles
     * them independently. Enforced at the `lib/table` service layer (see
     * `lib/table/mutation-locks.ts`), which covers every entry point — routes,
     * workflow blocks, and Mothership — since all funnel through those helpers.
     * A locked verb rejects with 423; toggling a lock requires workspace admin.
     * Append-only = update + delete locked; read-only = all four locked. These
     * are integrity controls (against accidental/agentic mutation), not
     * confidentiality controls — reads and exports are never blocked.
     */
    schemaLocked: boolean('schema_locked').notNull().default(false),
    insertLocked: boolean('insert_locked').notNull().default(false),
    updateLocked: boolean('update_locked').notNull().default(false),
    deleteLocked: boolean('delete_locked').notNull().default(false),
    archivedAt: timestamp('archived_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('user_table_def_workspace_id_idx').on(table.workspaceId),
    folderIdIdx: index('user_table_def_folder_id_idx').on(table.folderId),
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
    secretProvenanceVersion: integer('secret_provenance_version'),
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
    tableCreatedIdIdx: index('user_table_rows_table_created_id_idx').on(
      table.tableId,
      table.createdAt,
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
 * Encrypted secret provenance for a table row's current JSONB payload.
 * The sidecar is bound to `user_table_rows.updated_at`; a missing or stale
 * sidecar on a tracked row is treated as unknown at model re-entry.
 */
export const userTableRowSecretProvenance = pgTable(
  'user_table_row_secret_provenance',
  {
    rowId: text('row_id')
      .primaryKey()
      .references(() => userTableRows.id, { onDelete: 'cascade' }),
    contentUpdatedAt: timestamp('content_updated_at').notNull(),
    status: text('status').notNull(),
    entries: jsonb('entries').$type<TableRowSecretProvenanceEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'user_table_row_secret_provenance_status_check',
      sql`${table.status} IN ('exact', 'unknown')`
    ),
  })
)

/**
 * Saved views for a user-defined table — a named filter + sort + column layout.
 * Workspace-shared: anyone who can read the table sees every view, and `write` is
 * required to create, update, or delete one. New tables are seeded with one default
 * view; legacy tables without one temporarily retain the built-in "All" fallback.
 *
 * A dedicated table rather than a key on `user_table_definitions.metadata`: that
 * column is written read-modify-write with a shallow merge, so a stale snapshot
 * from any concurrent column resize would silently drop a view saved in between.
 * Per-view rows make each save an independent insert.
 */
export const tableViews = pgTable(
  'table_views',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => userTableDefinitions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * @remarks
     * `TableViewConfig` — `{ filter, sort, hiddenColumns, columnOrder, columnWidths,
     * pinnedColumns }`. Every column reference is keyed by stable column id, so a
     * rename never touches a saved view; ids of deleted columns are pruned on read.
     */
    config: jsonb('config').notNull().default('{}'),
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * Nullable with `set null` rather than the `cascade` used for table ownership:
     * a view is workspace-shared, so it must outlive the member who created it.
     */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    tableCreatedIdx: index('table_views_table_created_idx').on(table.tableId, table.createdAt),
    /** Covers workspace-scoped hydration without scanning every saved view. */
    workspaceCreatedIdx: index('table_views_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
      table.id
    ),
    /** At most one default view per table, enforced in the DB. */
    defaultViewUnique: uniqueIndex('table_views_table_default_unique')
      .on(table.tableId)
      .where(sql`is_default = true`),
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
     * Person whose permission group gates this cell's tools, persisted with the
     * dispatcher's `pending` pre-stamp.
     *
     * The stamp and the worker that runs it are not the same run: a cell task
     * that finds the row's cascade lock held bails, and the lock owner drains
     * the marker itself. That owner belongs to whatever dispatch queued IT, so
     * without the subject on the marker the drained cell would run under the
     * wrong person's group — or under none, when the owner is an actorless
     * auto-fire. Read only while the marker is unclaimed (`pending` with a null
     * `execution_id`); later writes on the same cell carry no subject and null
     * it, which is why nothing reads it after pickup.
     *
     * `ON DELETE SET NULL`, matching `table_run_dispatches`: a deleted person's
     * runs are stopped by that table's cancel, not held open by this reference.
     */
    capabilityGovernedUserId: text('capability_governed_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
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
    /** The person whose permission group governs what this run's cells may do.
     *  Distinct from `triggered_by_user_id`, which is an *attribution* and
     *  substitutes the workspace billed account when the credential names no
     *  human — right for a meter, wrong for a gate, since it would run a
     *  bystander's tool denylist against an actorless request. Null when the
     *  run has no acting person (workspace API key, schedule, auto-fire), which
     *  means no per-tool gate applies. Producers set it explicitly, `null`
     *  included: it is required on every dispatch input precisely so a new one
     *  cannot inherit the attribution by omission.
     *
     *  `set null` on delete, paired with a cancel of this account's non-terminal
     *  dispatches inside `deleteUserAccount`. Nulling alone would be a silent
     *  un-gate — the worker cannot tell a subject erased by deletion from one
     *  that was never there — and `restrict` would block account deletion behind
     *  background work. Going terminal first makes the nulled row unreachable. */
    capabilityGovernedUserId: text('capability_governed_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    /** Last time the dispatcher loop made progress on this dispatch. Stamped by
     *  the same per-window writes that advance `cursor` and `processed_count`,
     *  so it means "a holder is alive" rather than "this started a while ago" —
     *  the distinction the cleanup sweep needs, since `requested_at` never moves
     *  and a legitimately long dispatch would otherwise be reclaimed under a
     *  live holder. Null on rows written before this column existed; the sweep
     *  reads `COALESCE(heartbeat_at, requested_at)` so those stay reclaimable. */
    heartbeatAt: timestamp('heartbeat_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
  },
  (table) => ({
    activeIdx: index('table_run_dispatches_active_idx').on(table.tableId, table.status),
    watchdogIdx: index('table_run_dispatches_watchdog_idx').on(table.status, table.requestedAt),
    /** Account deletion cancels every still-active dispatch the departing
     *  account governs, and that is the only query keyed on the subject. The
     *  other two indexes lead with `table_id` / `status`, so without this one
     *  the deletion scans every active dispatch in the deployment while holding
     *  its transaction open. Partial on the two live statuses: a terminal row is
     *  never a cancellation target, and dispatch history is what grows. */
    governedActiveIdx: index('table_run_dispatches_governed_active_idx')
      .on(table.capabilityGovernedUserId, table.status)
      .where(sql`${table.status} IN ('pending', 'dispatching')`),
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

export const sandboxLanguageEnum = pgEnum('sandbox_language', ['javascript', 'python'])

export type SandboxLanguageValue = (typeof sandboxLanguageEnum.enumValues)[number]

export const sandboxImageStatusEnum = pgEnum('sandbox_image_status', [
  'pending',
  'building',
  'ready',
  'failed',
])

export type SandboxImageStatusValue = (typeof sandboxImageStatusEnum.enumValues)[number]

/**
 * A workspace's named library of dependency sets. Provider-agnostic: the same
 * row drives a prebuilt E2B template and a Daytona runtime install, and only the
 * materialization step differs. `specHash` is the content address shared with
 * `sandboxImage`, so editing dependencies points the sandbox at a new build
 * while the old one stays valid for in-flight executions.
 */
export const workspaceSandbox = pgTable(
  'workspace_sandbox',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    language: sandboxLanguageEnum('language').notNull(),
    dependencies: jsonb('dependencies').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    cliTools: jsonb('cli_tools').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    systemPackages: jsonb('system_packages').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    specHash: text('spec_hash').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceNameUnique: uniqueIndex('workspace_sandbox_workspace_name_unique').on(
      table.workspaceId,
      table.name
    ),
    workspaceIdx: index('workspace_sandbox_workspace_idx').on(table.workspaceId),
    specHashIdx: index('workspace_sandbox_spec_hash_idx').on(table.specHash),
  })
)

/**
 * Build registry for the prebuilt strategy, keyed by content address so two
 * workspaces declaring the same dependency set share one build. Never written
 * under a runtime-strategy provider.
 */
export const sandboxImage = pgTable(
  'sandbox_image',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    specHash: text('spec_hash').notNull(),
    spec: jsonb('spec').notNull(),
    status: sandboxImageStatusEnum('status').notNull().default('pending'),
    /** Passed to the provider at create time once `status` is `ready`. */
    imageRef: text('image_ref'),
    /** Provider-side image identifier, when it differs from `imageRef`. */
    providerImageId: text('provider_image_id'),
    buildId: text('build_id'),
    /** Monotonic target release for this provider materialization; legacy rows are generation 0. */
    materializationGeneration: bigint('materialization_generation', { mode: 'number' }),
    /** Classified taxonomy code; see lib/execution/remote-sandbox/build-errors.ts. */
    errorCode: text('error_code'),
    /** User-facing copy rendered from the code at classification time. */
    errorMessage: text('error_message'),
    /** Installer log tail, shown behind a disclosure. */
    errorDetail: text('error_detail'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    providerSpecUnique: uniqueIndex('sandbox_image_provider_spec_unique').on(
      table.provider,
      table.specHash
    ),
    statusIdx: index('sandbox_image_status_idx').on(table.status),
    lastUsedIdx: index('sandbox_image_last_used_idx').on(table.lastUsedAt),
  })
)

/** Operations a SCIM bearer credential is allowed to perform. */
export type ScimScope = 'users:read' | 'users:write' | 'groups:read' | 'groups:write'

export const SCIM_SCOPES: readonly ScimScope[] = [
  'users:read',
  'users:write',
  'groups:read',
  'groups:write',
]

/** Administrator-controlled behavior of one organization's SCIM connection. */
export interface ScimConnectionSettings {
  /**
   * Refuse manual invitations, workspace grants, and role edits for users the
   * identity provider manages; removals stay possible so an administrator can
   * always act in an emergency. Out-of-band edits desync the directory, so this
   * defaults to on for a new connection and an owner may turn it off.
   */
  lockManualMembership?: boolean
  /**
   * Turn off SSO just-in-time provisioning while the connection is active, so
   * the directory is the only way into the organization.
   */
  disableJit?: boolean
  /** Map a pushed group to an existing permission group of the same name. Nothing is created. */
  autoMapPermissionGroupsByName?: boolean
}

/** One email address as the identity provider supplied it. */
export interface ScimUserEmail {
  value: string
  type?: string
  primary: boolean
}

/**
 * The last User resource a connection sent, canonicalized. Stored whole so a
 * `GET` returns what the provider wrote and a `PATCH` applies to the provider's
 * own view rather than to a lossy projection of it.
 */
export interface ScimUserAttributes {
  userName: string
  externalId?: string
  active: boolean
  displayName?: string
  /** Older records synthesized displayName; unmarked records retain formatted-name account projection. */
  displayNameSource?: 'provider'
  name: {
    formatted: string
    givenName?: string
    familyName?: string
  }
  emails: ScimUserEmail[]
  enterprise?: {
    department?: string
    employeeNumber?: string
    costCenter?: string
    division?: string
    organization?: string
    manager?: { value?: string; displayName?: string }
  }
  /** Attributes Sim does not model, preserved so responses round-trip them. */
  extra?: Record<string, unknown>
}

/**
 * One directory-provisioning connection per organization.
 *
 * The bearer credential an identity provider presents resolves to this row, and
 * that row is the entire authorization scope: no SCIM request names an
 * organization, so no request can reach another tenant's users.
 */
export const scimConnection = pgTable(
  'scim_connection',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** `active` or `disabled`. Disabling refuses every credential immediately. */
    status: text('status').notNull().default('active'),
    settings: jsonb('settings').$type<ScimConnectionSettings>().notNull().default({}),
    lastRequestAt: timestamp('last_request_at'),
    /** Reconcile-job lease, in the shape the connector member sync already uses. */
    reconcileLockToken: text('reconcile_lock_token'),
    reconcileLeaseAt: timestamp('reconcile_lease_at'),
    reconciledAt: timestamp('reconciled_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationUnique: uniqueIndex('scim_connection_organization_unique').on(table.organizationId),
    reconcileDueIdx: index('scim_connection_reconcile_due_idx').on(table.reconciledAt),
  })
)

/**
 * A bearer credential for one connection.
 *
 * Only the SHA-256 digest is stored, so a database read cannot recover a live
 * token. Two credentials may be active at once, which is what lets an
 * administrator rotate without a window where the directory cannot authenticate.
 */
export const scimCredential = pgTable(
  'scim_credential',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => scimConnection.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** Leading characters of the token, for identifying it in the settings list. */
    tokenPrefix: text('token_prefix').notNull(),
    scopes: jsonb('scopes').$type<ScimScope[]>().notNull(),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp('last_used_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('scim_credential_token_hash_unique').on(table.tokenHash),
    connectionIdx: index('scim_credential_connection_idx').on(table.connectionId),
  })
)

/**
 * The User resource one connection provisioned, and its link to a Sim account.
 *
 * `id` is the SCIM resource id the provider stores and addresses; it is never a
 * Sim user id, so a provider cannot reach an account it did not provision by
 * guessing one.
 */
export const scimUser = pgTable(
  'scim_user',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => scimConnection.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    /** Lower-cased `userName`; the uniqueness and lookup key within a connection. */
    userName: text('user_name').notNull(),
    active: boolean('active').notNull().default(true),
    attributes: jsonb('attributes').$type<ScimUserAttributes>().notNull(),
    /**
     * Stable ascending sort key for pagination. A provider pages with
     * `startIndex`, so the order must not shift between pages the way
     * `created_at` alone can when rows share a timestamp.
     */
    orderKey: text('order_key').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    connectionUserUnique: uniqueIndex('scim_user_connection_user_unique').on(
      table.connectionId,
      table.userId
    ),
    connectionUserNameUnique: uniqueIndex('scim_user_connection_user_name_unique').on(
      table.connectionId,
      table.userName
    ),
    connectionExternalIdUnique: uniqueIndex('scim_user_connection_external_id_unique')
      .on(table.connectionId, table.externalId)
      .where(sql`external_id is not null`),
    connectionOrderIdx: index('scim_user_connection_order_idx').on(
      table.connectionId,
      table.orderKey
    ),
    userIdx: index('scim_user_user_idx').on(table.userId),
  })
)

/**
 * Remembers which Sim account a deleted external identity belonged to.
 *
 * Directories delete and recreate a person for an ordinary rename or rehire. The
 * tombstone makes the recreated resource relink to the same account instead of
 * creating a second one, which is what would otherwise strand the original.
 */
export const scimUserTombstone = pgTable(
  'scim_user_tombstone',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => scimConnection.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at').notNull().defaultNow(),
  },
  (table) => ({
    connectionExternalIdUnique: uniqueIndex('scim_user_tombstone_connection_external_id_unique').on(
      table.connectionId,
      table.externalId
    ),
    userIdx: index('scim_user_tombstone_user_idx').on(table.userId),
  })
)

/** A Group resource one connection provisioned. */
export const scimGroup = pgTable(
  'scim_group',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => scimConnection.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    displayName: text('display_name').notNull(),
    /**
     * Lower-cased `displayName`. Uniqueness is case-insensitive because
     * Microsoft Entra treats a group name as its match key and will otherwise
     * create a duplicate whose only difference is capitalization.
     */
    displayNameKey: text('display_name_key').notNull(),
    orderKey: text('order_key').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    connectionDisplayNameUnique: uniqueIndex('scim_group_connection_display_name_unique').on(
      table.connectionId,
      table.displayNameKey
    ),
    connectionExternalIdUnique: uniqueIndex('scim_group_connection_external_id_unique')
      .on(table.connectionId, table.externalId)
      .where(sql`external_id is not null`),
    connectionOrderIdx: index('scim_group_connection_order_idx').on(
      table.connectionId,
      table.orderKey
    ),
  })
)

/** Membership of a provisioned group. */
export const scimGroupMember = pgTable(
  'scim_group_member',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => scimGroup.id, { onDelete: 'cascade' }),
    scimUserId: text('scim_user_id')
      .notNull()
      .references(() => scimUser.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    groupUserUnique: uniqueIndex('scim_group_member_group_user_unique').on(
      table.groupId,
      table.scimUserId
    ),
    scimUserIdx: index('scim_group_member_scim_user_idx').on(table.scimUserId),
  })
)

/**
 * What a directory group means inside Sim, as an administrator configured it.
 *
 * A group may carry several mappings — a permission group, one or more
 * workspaces, and the organization admin role are independent targets.
 */
export const scimGroupMapping = pgTable(
  'scim_group_mapping',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => scimGroup.id, { onDelete: 'cascade' }),
    /** `permission_group`, `workspace`, or `org_role`. */
    targetKind: text('target_kind').notNull(),
    permissionGroupId: text('permission_group_id').references(() => permissionGroup.id, {
      onDelete: 'cascade',
    }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    /** Permission granted on `workspaceId`, for workspace targets. */
    permissionType: permissionTypeEnum('permission_type'),
    /** Organization role granted, for `org_role` targets. Only `admin` is accepted. */
    role: text('role'),
    /**
     * `automatic` mappings were made by name matching and are replaced when the
     * group is renamed; `manual` ones were made by an administrator and are
     * never removed by a sync. Kept apart from `createdBy`, which goes null when
     * its author's account is deleted.
     */
    source: text('source').notNull().default('manual'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('scim_group_mapping_group_idx').on(table.groupId),
    permissionGroupIdx: index('scim_group_mapping_permission_group_idx').on(
      table.permissionGroupId
    ),
    workspaceIdx: index('scim_group_mapping_workspace_idx').on(table.workspaceId),
    /**
     * One mapping per group and target. `coalesce` collapses the three mutually
     * exclusive target columns into the single value that identifies the target,
     * so a group cannot carry the same workspace twice at two permissions.
     */
    groupTargetUnique: uniqueIndex('scim_group_mapping_group_target_unique').on(
      table.groupId,
      table.targetKind,
      sql`coalesce(${table.permissionGroupId}, ${table.workspaceId}, ${table.role})`
    ),
    /** Exactly the columns belonging to `target_kind` are populated. */
    targetShape: check(
      'scim_group_mapping_target_shape',
      sql`(
        (${table.targetKind} = 'permission_group' AND ${table.permissionGroupId} IS NOT NULL AND ${table.workspaceId} IS NULL AND ${table.permissionType} IS NULL AND ${table.role} IS NULL)
        OR (${table.targetKind} = 'workspace' AND ${table.workspaceId} IS NOT NULL AND ${table.permissionType} IS NOT NULL AND ${table.permissionGroupId} IS NULL AND ${table.role} IS NULL)
        OR (${table.targetKind} = 'org_role' AND ${table.role} IS NOT NULL AND ${table.permissionGroupId} IS NULL AND ${table.workspaceId} IS NULL AND ${table.permissionType} IS NULL)
      )`
    ),
  })
)

/**
 * Provenance for every access SCIM granted.
 *
 * Without it, withdrawing a group's access could not tell an access the
 * directory granted from one a workspace administrator granted by hand, and a
 * routine group change would revoke the administrator's work.
 */
export const scimProjectionGrant = pgTable(
  'scim_projection_grant',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => scimConnection.id, { onDelete: 'cascade' }),
    scimUserId: text('scim_user_id')
      .notNull()
      .references(() => scimUser.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind').notNull(),
    /** Permission group id, workspace id, or the granted organization role. */
    targetId: text('target_id').notNull(),
    /** The permission SCIM set, so a later manual upgrade stays detectable. */
    permissionType: permissionTypeEnum('permission_type'),
    /** Manual workspace access to restore when an unlocked directory withdraws its grant. */
    baselinePermission: permissionTypeEnum('baseline_permission'),
    /**
     * `directory` when the directory created the access; `adopted` when the
     * person already held it by hand and a mapping merely covers it. Adopted
     * access is left in place when the mapping goes away, unless the directory
     * is the organization's source of truth.
     */
    origin: text('origin').notNull().default('directory'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userTargetUnique: uniqueIndex('scim_projection_grant_user_target_unique').on(
      table.scimUserId,
      table.targetKind,
      table.targetId
    ),
    connectionIdx: index('scim_projection_grant_connection_idx').on(table.connectionId),
  })
)

/**
 * Recent provisioning requests, for the settings activity view.
 *
 * Microsoft Entra reports a failed sync without saying what it sent, so an
 * administrator debugging a connection has no other way to see the request that
 * failed. Pruned by the reconcile job.
 */
export const scimRequestLog = pgTable(
  'scim_request_log',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => scimConnection.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id'),
    method: text('method').notNull(),
    /** Resource path only. Query strings can carry directory attribute values. */
    path: text('path').notNull(),
    status: integer('status').notNull(),
    scimType: text('scim_type'),
    detail: text('detail'),
    userAgent: text('user_agent'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    connectionCreatedIdx: index('scim_request_log_connection_created_idx').on(
      table.connectionId,
      table.createdAt
    ),
  })
)
