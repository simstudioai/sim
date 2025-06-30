import { type SQL, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  decimal,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'

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
})

export const session = pgTable('session', {
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
})

export const account = pgTable('account', {
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
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

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

export const workflow = pgTable('workflow', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').references(() => workflowFolder.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  // DEPRECATED: Use normalized tables (workflow_blocks, workflow_edges, workflow_subflows) instead
  state: json('state').notNull(),
  color: text('color').notNull().default('#3972F6'),
  lastSynced: timestamp('last_synced').notNull(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  isDeployed: boolean('is_deployed').notNull().default(false),
  deployedState: json('deployed_state'),
  deployedAt: timestamp('deployed_at'),
  collaborators: json('collaborators').notNull().default('[]'),
  runCount: integer('run_count').notNull().default(0),
  lastRunAt: timestamp('last_run_at'),
  variables: json('variables').default('{}'),
  isPublished: boolean('is_published').notNull().default(false),
  marketplaceData: json('marketplace_data'),
})

// New normalized workflow tables
export const workflowBlocks = pgTable(
  'workflow_blocks',
  {
    // Primary identification
    id: text('id').primaryKey(), // Block UUID from the current JSON structure
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }), // Link to parent workflow

    // Block properties (from current BlockState interface)
    type: text('type').notNull(), // e.g., 'starter', 'agent', 'api', 'function'
    name: text('name').notNull(), // Display name of the block

    // Position coordinates (from position.x, position.y)
    positionX: decimal('position_x').notNull(), // X coordinate on canvas
    positionY: decimal('position_y').notNull(), // Y coordinate on canvas

    // Block behavior flags (from current BlockState)
    enabled: boolean('enabled').notNull().default(true), // Whether block is active
    horizontalHandles: boolean('horizontal_handles').notNull().default(true), // UI layout preference
    isWide: boolean('is_wide').notNull().default(false), // Whether block uses wide layout
    advancedMode: boolean('advanced_mode').notNull().default(false), // Whether block is in advanced mode
    height: decimal('height').notNull().default('0'), // Custom height override

    // Block data (keeping JSON for flexibility as current system does)
    subBlocks: jsonb('sub_blocks').notNull().default('{}'), // All subblock configurations
    outputs: jsonb('outputs').notNull().default('{}'), // Output type definitions
    data: jsonb('data').default('{}'), // Additional block-specific data

    // Hierarchy support (for loop/parallel child blocks)
    parentId: text('parent_id'), // Self-reference handled by foreign key constraint in migration
    extent: text('extent'), // 'parent' or null - for ReactFlow parent constraint

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern: get all blocks for a workflow
    workflowIdIdx: index('workflow_blocks_workflow_id_idx').on(table.workflowId),

    // For finding child blocks of a parent (loop/parallel containers)
    parentIdIdx: index('workflow_blocks_parent_id_idx').on(table.parentId),

    // Composite index for efficient parent-child queries
    workflowParentIdx: index('workflow_blocks_workflow_parent_idx').on(
      table.workflowId,
      table.parentId
    ),

    // For block type filtering/analytics
    workflowTypeIdx: index('workflow_blocks_workflow_type_idx').on(table.workflowId, table.type),
  })
)

export const workflowEdges = pgTable(
  'workflow_edges',
  {
    // Primary identification
    id: text('id').primaryKey(), // Edge UUID from ReactFlow
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }), // Link to parent workflow

    // Connection definition (from ReactFlow Edge interface)
    sourceBlockId: text('source_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }), // Source block ID
    targetBlockId: text('target_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }), // Target block ID
    sourceHandle: text('source_handle'), // Specific output handle (optional)
    targetHandle: text('target_handle'), // Specific input handle (optional)

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern: get all edges for a workflow
    workflowIdIdx: index('workflow_edges_workflow_id_idx').on(table.workflowId),

    // For finding outgoing connections from a block
    sourceBlockIdx: index('workflow_edges_source_block_idx').on(table.sourceBlockId),

    // For finding incoming connections to a block
    targetBlockIdx: index('workflow_edges_target_block_idx').on(table.targetBlockId),

    // For comprehensive workflow topology queries
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
    // Primary identification
    id: text('id').primaryKey(), // Subflow UUID (currently loop/parallel ID)
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }), // Link to parent workflow

    // Subflow type and configuration
    type: text('type').notNull(), // 'loop' or 'parallel' (extensible for future types)
    config: jsonb('config').notNull().default('{}'), // Type-specific configuration

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern: get all subflows for a workflow
    workflowIdIdx: index('workflow_subflows_workflow_id_idx').on(table.workflowId),

    // For filtering by subflow type
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

export const workflowLogs = pgTable('workflow_logs', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflow.id, { onDelete: 'cascade' }),
  executionId: text('execution_id'),
  level: text('level').notNull(), // e.g. "info", "error", etc.
  message: text('message').notNull(),
  duration: text('duration'), // Store as text to allow 'NA' for errors
  trigger: text('trigger'), // e.g. "api", "schedule", "manual"
  createdAt: timestamp('created_at').notNull().defaultNow(),
  metadata: json('metadata'), // Optional JSON field for storing additional context like tool calls
})

export const environment = pgTable('environment', {
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One environment per user
  variables: json('variables').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const settings = pgTable('settings', {
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One settings record per user

  // General settings
  theme: text('theme').notNull().default('system'),
  debugMode: boolean('debug_mode').notNull().default(false),
  autoConnect: boolean('auto_connect').notNull().default(true),
  autoFillEnvVars: boolean('auto_fill_env_vars').notNull().default(true),

  // Privacy settings
  telemetryEnabled: boolean('telemetry_enabled').notNull().default(true),
  telemetryNotifiedUser: boolean('telemetry_notified_user').notNull().default(false),

  // Email preferences
  emailPreferences: json('email_preferences').notNull().default('{}'),

  // Keep general for future flexible settings
  general: json('general').notNull().default('{}'),

  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workflowSchedule = pgTable('workflow_schedule', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflow.id, { onDelete: 'cascade' })
    .unique(),
  cronExpression: text('cron_expression'),
  nextRunAt: timestamp('next_run_at'),
  lastRanAt: timestamp('last_ran_at'),
  triggerType: text('trigger_type').notNull(), // "manual", "webhook", "schedule"
  timezone: text('timezone').notNull().default('UTC'),
  failedCount: integer('failed_count').notNull().default(0), // Track consecutive failures
  status: text('status').notNull().default('active'), // 'active' or 'disabled'
  lastFailedAt: timestamp('last_failed_at'), // When the schedule last failed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const webhook = pgTable(
  'webhook',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    provider: text('provider'), // e.g., "whatsapp", "github", etc.
    providerConfig: json('provider_config'), // Store provider-specific configuration
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure webhook paths are unique
      pathIdx: uniqueIndex('path_idx').on(table.path),
    }
  }
)

export const apiKey = pgTable('api_key', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  lastUsed: timestamp('last_used'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
})

export const marketplace = pgTable('marketplace', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflow.id, { onDelete: 'cascade' }),
  state: json('state').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  authorId: text('author_id')
    .notNull()
    .references(() => user.id),
  authorName: text('author_name').notNull(),
  views: integer('views').notNull().default(0),
  category: text('category'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  totalCost: decimal('total_cost').notNull().default('0'),
  lastActive: timestamp('last_active').notNull().defaultNow(),
})

export const customTools = pgTable('custom_tools', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  schema: json('schema').notNull(),
  code: text('code').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const subscription = pgTable('subscription', {
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
    subdomain: text('subdomain').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    customizations: json('customizations').default('{}'), // For UI customization options

    // Authentication options
    authType: text('auth_type').notNull().default('public'), // 'public', 'password', 'email'
    password: text('password'), // Stored hashed, populated when authType is 'password'
    allowedEmails: json('allowed_emails').default('[]'), // Array of allowed emails or domains when authType is 'email'

    // Output configuration
    outputConfigs: json('output_configs').default('[]'), // Array of {blockId, path} objects

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure subdomains are unique
      subdomainIdx: uniqueIndex('subdomain_idx').on(table.subdomain),
    }
  }
)

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const invitation = pgTable('invitation', {
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
})

export const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workspaceMember = pgTable(
  'workspace_member',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // e.g., 'owner', 'admin', 'member'
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Create index on userId for fast lookups of workspaces by user
      userIdIdx: uniqueIndex('user_workspace_idx').on(table.userId, table.workspaceId),
    }
  }
)

// Define the permission enum
export const permissionTypeEnum = pgEnum('permission_type', ['admin', 'write', 'read'])

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
  status: text('status').notNull().default('pending'),
  token: text('token').notNull().unique(),
  permissions: permissionTypeEnum('permissions').notNull().default('admin'),
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
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // Identifier for the memory within its context
    type: text('type').notNull(), // 'agent' or 'raw'
    data: json('data').notNull(), // Stores either agent message data or raw data
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => {
    return {
      // Add index on key for faster lookups
      keyIdx: index('memory_key_idx').on(table.key),

      // Add index on workflowId for faster filtering
      workflowIdx: index('memory_workflow_idx').on(table.workflowId),

      // Compound unique index to ensure keys are unique per workflow
      uniqueKeyPerWorkflowIdx: uniqueIndex('memory_workflow_key_idx').on(
        table.workflowId,
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
      .default('{"maxSize": 1024, "minSize": 100, "overlap": 200}'),

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

    // Timestamps
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern - documents by knowledge base
    knowledgeBaseIdIdx: index('doc_kb_id_idx').on(table.knowledgeBaseId),
    // Search by filename (for search functionality)
    filenameIdx: index('doc_filename_idx').on(table.filename),
    // Order by upload date (for listing documents)
    kbUploadedAtIdx: index('doc_kb_uploaded_at_idx').on(table.knowledgeBaseId, table.uploadedAt),
    // Processing status filtering
    processingStatusIdx: index('doc_processing_status_idx').on(
      table.knowledgeBaseId,
      table.processingStatus
    ),
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

    // Rich metadata for advanced filtering
    metadata: jsonb('metadata').notNull().default('{}'),

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

    // GIN index for JSONB metadata queries
    metadataGinIdx: index('emb_metadata_gin_idx').using('gin', table.metadata),

    // Full-text search index
    contentFtsIdx: index('emb_content_fts_idx').using('gin', table.contentTsv),

    // Ensure embedding exists (simplified since we only support one model)
    embeddingNotNullCheck: check('embedding_not_null_check', sql`"embedding" IS NOT NULL`),
  })
)
