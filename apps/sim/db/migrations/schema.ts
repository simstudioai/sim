import { pgTable, text, timestamp, foreignKey, unique, index, serial, json, uniqueIndex, boolean, integer, numeric, jsonb, check, vector } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const verification = pgTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
});

export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: 'string' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const waitlist = pgTable("waitlist", {
	id: text().primaryKey().notNull(),
	email: text().notNull(),
	status: text().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("waitlist_email_unique").on(table.email),
]);

export const workflowBroadcastConnections = pgTable("workflow_broadcast_connections", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	workflowId: text("workflow_id").notNull(),
	connectionId: text("connection_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	lastSeen: timestamp("last_seen", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_workflow_broadcast_connections_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("idx_workflow_broadcast_connections_workflow").using("btree", table.workflowId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "workflow_broadcast_connections_workflow_id_fkey"
		}).onDelete("cascade"),
	unique("workflow_broadcast_connections_connection_id_key").on(table.connectionId),
]);

export const environment = pgTable("environment", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	variables: json().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "environment_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("environment_user_id_unique").on(table.userId),
]);

export const webhook = pgTable("webhook", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	path: text().notNull(),
	provider: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	providerConfig: json("provider_config"),
}, (table) => [
	uniqueIndex("path_idx").using("btree", table.path.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "webhook_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
]);

export const workflowLogs = pgTable("workflow_logs", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	executionId: text("execution_id"),
	level: text().notNull(),
	message: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	duration: text(),
	trigger: text(),
	metadata: json(),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "workflow_logs_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
]);

export const apiKey = pgTable("api_key", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	name: text().notNull(),
	key: text().notNull(),
	lastUsed: timestamp("last_used", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "api_key_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("api_key_key_unique").on(table.key),
]);

export const marketplace = pgTable("marketplace", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	state: json().notNull(),
	name: text().notNull(),
	description: text(),
	authorId: text("author_id").notNull(),
	authorName: text("author_name").notNull(),
	views: integer().default(0).notNull(),
	category: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "marketplace_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [user.id],
			name: "marketplace_author_id_user_id_fk"
		}),
]);

export const customTools = pgTable("custom_tools", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	title: text().notNull(),
	schema: json().notNull(),
	code: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "custom_tools_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean("email_verified").notNull(),
	image: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	stripeCustomerId: text("stripe_customer_id"),
}, (table) => [
	unique("user_email_unique").on(table.email),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull(),
	activeOrganizationId: text("active_organization_id"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.activeOrganizationId],
			foreignColumns: [organization.id],
			name: "session_active_organization_id_organization_id_fk"
		}).onDelete("set null"),
	unique("session_token_unique").on(table.token),
]);

export const invitation = pgTable("invitation", {
	id: text().primaryKey().notNull(),
	email: text().notNull(),
	inviterId: text("inviter_id").notNull(),
	organizationId: text("organization_id").notNull(),
	role: text().notNull(),
	status: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.inviterId],
			foreignColumns: [user.id],
			name: "invitation_inviter_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "invitation_organization_id_organization_id_fk"
		}).onDelete("cascade"),
]);

export const member = pgTable("member", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	organizationId: text("organization_id").notNull(),
	role: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "member_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "member_organization_id_organization_id_fk"
		}).onDelete("cascade"),
]);

export const chat = pgTable("chat", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	userId: text("user_id").notNull(),
	subdomain: text().notNull(),
	title: text().notNull(),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	customizations: json().default({}),
	authType: text("auth_type").default('public').notNull(),
	password: text(),
	allowedEmails: json("allowed_emails").default([]),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	outputConfigs: json("output_configs").default([]),
}, (table) => [
	uniqueIndex("subdomain_idx").using("btree", table.subdomain.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "chat_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "chat_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const settings = pgTable("settings", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	general: json().default({}).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	theme: text().default('system').notNull(),
	debugMode: boolean("debug_mode").default(false).notNull(),
	autoConnect: boolean("auto_connect").default(true).notNull(),
	autoFillEnvVars: boolean("auto_fill_env_vars").default(true).notNull(),
	telemetryEnabled: boolean("telemetry_enabled").default(true).notNull(),
	telemetryNotifiedUser: boolean("telemetry_notified_user").default(false).notNull(),
	emailPreferences: json("email_preferences").default({}).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "settings_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("settings_user_id_unique").on(table.userId),
]);

export const workspace = pgTable("workspace", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	ownerId: text("owner_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [user.id],
			name: "workspace_owner_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const workspaceMember = pgTable("workspace_member", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	userId: text("user_id").notNull(),
	role: text().default('member').notNull(),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("user_workspace_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.workspaceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspace.id],
			name: "workspace_member_workspace_id_workspace_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "workspace_member_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const workspaceInvitation = pgTable("workspace_invitation", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	email: text().notNull(),
	inviterId: text("inviter_id").notNull(),
	role: text().default('member').notNull(),
	status: text().default('pending').notNull(),
	token: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspace.id],
			name: "workspace_invitation_workspace_id_workspace_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.inviterId],
			foreignColumns: [user.id],
			name: "workspace_invitation_inviter_id_user_id_fk"
		}).onDelete("cascade"),
	unique("workspace_invitation_token_unique").on(table.token),
]);

export const organization = pgTable("organization", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	logo: text(),
	metadata: json(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const subscription = pgTable("subscription", {
	id: text().primaryKey().notNull(),
	plan: text().notNull(),
	referenceId: text("reference_id").notNull(),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	status: text(),
	periodStart: timestamp("period_start", { mode: 'string' }),
	periodEnd: timestamp("period_end", { mode: 'string' }),
	cancelAtPeriodEnd: boolean("cancel_at_period_end"),
	seats: integer(),
	trialStart: timestamp("trial_start", { mode: 'string' }),
	trialEnd: timestamp("trial_end", { mode: 'string' }),
	metadata: json(),
});

export const userStats = pgTable("user_stats", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	totalManualExecutions: integer("total_manual_executions").default(0).notNull(),
	totalApiCalls: integer("total_api_calls").default(0).notNull(),
	totalWebhookTriggers: integer("total_webhook_triggers").default(0).notNull(),
	totalScheduledExecutions: integer("total_scheduled_executions").default(0).notNull(),
	totalTokensUsed: integer("total_tokens_used").default(0).notNull(),
	totalCost: numeric("total_cost").default('0').notNull(),
	lastActive: timestamp("last_active", { mode: 'string' }).defaultNow().notNull(),
	totalChatExecutions: integer("total_chat_executions").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_stats_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("user_stats_user_id_unique").on(table.userId),
]);

export const workflow = pgTable("workflow", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	name: text().notNull(),
	description: text(),
	state: json().notNull(),
	lastSynced: timestamp("last_synced", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	isDeployed: boolean("is_deployed").default(false).notNull(),
	deployedAt: timestamp("deployed_at", { mode: 'string' }),
	color: text().default('#3972F6').notNull(),
	collaborators: json().default([]).notNull(),
	isPublished: boolean("is_published").default(false).notNull(),
	runCount: integer("run_count").default(0).notNull(),
	lastRunAt: timestamp("last_run_at", { mode: 'string' }),
	variables: json().default({}),
	marketplaceData: json("marketplace_data"),
	deployedHash: text("deployed_hash"),
	workspaceId: text("workspace_id"),
	folderId: text("folder_id"),
	deployedState: json("deployed_state"),
	lastSaved: timestamp("last_saved", { mode: 'string' }),
	deploymentStatuses: jsonb("deployment_statuses").default({}),
	hasActiveSchedule: boolean("has_active_schedule").default(false),
	hasActiveWebhook: boolean("has_active_webhook").default(false),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "workflow_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspace.id],
			name: "workflow_workspace_id_workspace_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.folderId],
			foreignColumns: [workflowFolder.id],
			name: "workflow_folder_id_workflow_folder_id_fk"
		}).onDelete("set null"),
]);

export const workflowSchedule = pgTable("workflow_schedule", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	cronExpression: text("cron_expression"),
	nextRunAt: timestamp("next_run_at", { mode: 'string' }),
	lastRanAt: timestamp("last_ran_at", { mode: 'string' }),
	triggerType: text("trigger_type").notNull(),
	timezone: text().default('UTC').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	failedCount: integer("failed_count").default(0).notNull(),
	status: text().default('active').notNull(),
	lastFailedAt: timestamp("last_failed_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "workflow_schedule_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
	unique("workflow_schedule_workflow_id_unique").on(table.workflowId),
]);

export const memory = pgTable("memory", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id"),
	key: text().notNull(),
	type: text().notNull(),
	data: json().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
}, (table) => [
	index("memory_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")),
	index("memory_workflow_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops")),
	uniqueIndex("memory_workflow_key_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.key.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "memory_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
]);

export const knowledgeBase = pgTable("knowledge_base", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	workspaceId: text("workspace_id"),
	name: text().notNull(),
	description: text(),
	tokenCount: integer("token_count").default(0).notNull(),
	embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
	embeddingDimension: integer("embedding_dimension").default(1536).notNull(),
	chunkingConfig: json("chunking_config").default({"maxSize":1024,"minSize":100,"overlap":200}).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("kb_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("kb_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("kb_user_workspace_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.workspaceId.asc().nullsLast().op("text_ops")),
	index("kb_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "knowledge_base_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspace.id],
			name: "knowledge_base_workspace_id_workspace_id_fk"
		}).onDelete("cascade"),
]);

export const document = pgTable("document", {
	id: text().primaryKey().notNull(),
	knowledgeBaseId: text("knowledge_base_id").notNull(),
	filename: text().notNull(),
	fileUrl: text("file_url").notNull(),
	fileSize: integer("file_size").notNull(),
	mimeType: text("mime_type").notNull(),
	fileHash: text("file_hash"),
	chunkCount: integer("chunk_count").default(0).notNull(),
	tokenCount: integer("token_count").default(0).notNull(),
	characterCount: integer("character_count").default(0).notNull(),
	enabled: boolean().default(true).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	uploadedAt: timestamp("uploaded_at", { mode: 'string' }).defaultNow().notNull(),
	processingStatus: text("processing_status").default('pending').notNull(),
	processingStartedAt: timestamp("processing_started_at", { mode: 'string' }),
	processingCompletedAt: timestamp("processing_completed_at", { mode: 'string' }),
	processingError: text("processing_error"),
}, (table) => [
	index("doc_file_hash_idx").using("btree", table.fileHash.asc().nullsLast().op("text_ops")),
	index("doc_filename_idx").using("btree", table.filename.asc().nullsLast().op("text_ops")),
	index("doc_kb_id_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("text_ops")),
	index("doc_kb_uploaded_at_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("timestamp_ops"), table.uploadedAt.asc().nullsLast().op("timestamp_ops")),
	index("doc_processing_status_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("text_ops"), table.processingStatus.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.knowledgeBaseId],
			foreignColumns: [knowledgeBase.id],
			name: "document_knowledge_base_id_knowledge_base_id_fk"
		}).onDelete("cascade"),
]);

export const workflowFolder = pgTable("workflow_folder", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	userId: text("user_id").notNull(),
	workspaceId: text("workspace_id").notNull(),
	parentId: text("parent_id"),
	color: text().default('#6B7280'),
	isExpanded: boolean("is_expanded").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("workflow_folder_parent_sort_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("text_ops")),
	index("workflow_folder_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("workflow_folder_workspace_parent_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "workflow_folder_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspace.id],
			name: "workflow_folder_workspace_id_workspace_id_fk"
		}).onDelete("cascade"),
]);

export const embedding = pgTable("embedding", {
	id: text().primaryKey().notNull(),
	knowledgeBaseId: text("knowledge_base_id").notNull(),
	documentId: text("document_id").notNull(),
	chunkIndex: integer("chunk_index").notNull(),
	chunkHash: text("chunk_hash").notNull(),
	content: text().notNull(),
	contentLength: integer("content_length").notNull(),
	tokenCount: integer("token_count").notNull(),
	embedding: vector({ dimensions: 1536 }),
	embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
	startOffset: integer("start_offset").notNull(),
	endOffset: integer("end_offset").notNull(),
	overlapTokens: integer("overlap_tokens").default(0).notNull(),
	metadata: jsonb().default({}).notNull(),
	searchRank: numeric("search_rank").default('1.0'),
	accessCount: integer("access_count").default(0).notNull(),
	lastAccessedAt: timestamp("last_accessed_at", { mode: 'string' }),
	qualityScore: numeric("quality_score"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	// TODO: failed to parse database type 'tsvector'
	contentTsv: unknown("content_tsv").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, content)`),
	enabled: boolean().default(true).notNull(),
}, (table) => [
	index("emb_chunk_hash_idx").using("btree", table.chunkHash.asc().nullsLast().op("text_ops")),
	index("emb_content_fts_idx").using("gin", table.contentTsv.asc().nullsLast().op("tsvector_ops")),
	uniqueIndex("emb_doc_chunk_idx").using("btree", table.documentId.asc().nullsLast().op("int4_ops"), table.chunkIndex.asc().nullsLast().op("int4_ops")),
	index("emb_doc_enabled_idx").using("btree", table.documentId.asc().nullsLast().op("text_ops"), table.enabled.asc().nullsLast().op("bool_ops")),
	index("emb_doc_id_idx").using("btree", table.documentId.asc().nullsLast().op("text_ops")),
	index("emb_kb_access_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("timestamp_ops"), table.lastAccessedAt.asc().nullsLast().op("text_ops")),
	index("emb_kb_enabled_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("bool_ops"), table.enabled.asc().nullsLast().op("bool_ops")),
	index("emb_kb_id_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("text_ops")),
	index("emb_kb_model_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("text_ops"), table.embeddingModel.asc().nullsLast().op("text_ops")),
	index("emb_kb_rank_idx").using("btree", table.knowledgeBaseId.asc().nullsLast().op("text_ops"), table.searchRank.asc().nullsLast().op("text_ops")),
	index("emb_metadata_gin_idx").using("gin", table.metadata.asc().nullsLast().op("jsonb_ops")),
	index("embedding_vector_hnsw_idx").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")).with({m: "16",ef_construction: "64"}),
	foreignKey({
			columns: [table.knowledgeBaseId],
			foreignColumns: [knowledgeBase.id],
			name: "embedding_knowledge_base_id_knowledge_base_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [document.id],
			name: "embedding_document_id_document_id_fk"
		}).onDelete("cascade"),
	check("embedding_not_null_check", sql`embedding IS NOT NULL`),
]);

export const workflowBlocks = pgTable("workflow_blocks", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	type: text().notNull(),
	name: text().notNull(),
	positionX: integer("position_x").notNull(),
	positionY: integer("position_y").notNull(),
	enabled: boolean().default(true).notNull(),
	horizontalHandles: boolean("horizontal_handles").default(true).notNull(),
	isWide: boolean("is_wide").default(false).notNull(),
	height: integer().default(0).notNull(),
	subBlocks: jsonb("sub_blocks").default({}).notNull(),
	outputs: jsonb().default({}).notNull(),
	data: jsonb().default({}),
	parentId: text("parent_id"),
	extent: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	deployHash: text("deploy_hash"),
}, (table) => [
	index("workflow_blocks_deploy_hash_idx").using("btree", table.deployHash.asc().nullsLast().op("text_ops")),
	index("workflow_blocks_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	index("workflow_blocks_workflow_deploy_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.deployHash.asc().nullsLast().op("text_ops")),
	index("workflow_blocks_workflow_id_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops")),
	index("workflow_blocks_workflow_parent_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.parentId.asc().nullsLast().op("text_ops")),
	index("workflow_blocks_workflow_type_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "workflow_blocks_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "workflow_blocks_parent_id_workflow_blocks_id_fk"
		}).onDelete("cascade"),
]);

export const workflowEdges = pgTable("workflow_edges", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	sourceBlockId: text("source_block_id").notNull(),
	targetBlockId: text("target_block_id").notNull(),
	sourceHandle: text("source_handle"),
	targetHandle: text("target_handle"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	deployHash: text("deploy_hash"),
}, (table) => [
	index("workflow_edges_deploy_hash_idx").using("btree", table.deployHash.asc().nullsLast().op("text_ops")),
	index("workflow_edges_source_block_idx").using("btree", table.sourceBlockId.asc().nullsLast().op("text_ops")),
	index("workflow_edges_target_block_idx").using("btree", table.targetBlockId.asc().nullsLast().op("text_ops")),
	index("workflow_edges_workflow_deploy_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.deployHash.asc().nullsLast().op("text_ops")),
	index("workflow_edges_workflow_id_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops")),
	index("workflow_edges_workflow_source_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.sourceBlockId.asc().nullsLast().op("text_ops")),
	index("workflow_edges_workflow_target_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.targetBlockId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "workflow_edges_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sourceBlockId],
			foreignColumns: [workflowBlocks.id],
			name: "workflow_edges_source_block_id_workflow_blocks_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.targetBlockId],
			foreignColumns: [workflowBlocks.id],
			name: "workflow_edges_target_block_id_workflow_blocks_id_fk"
		}).onDelete("cascade"),
]);

export const workflowSubflows = pgTable("workflow_subflows", {
	id: text().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	type: text().notNull(),
	config: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	deployHash: text("deploy_hash"),
}, (table) => [
	index("workflow_subflows_deploy_hash_idx").using("btree", table.deployHash.asc().nullsLast().op("text_ops")),
	index("workflow_subflows_workflow_deploy_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.deployHash.asc().nullsLast().op("text_ops")),
	index("workflow_subflows_workflow_id_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops")),
	index("workflow_subflows_workflow_type_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflowId],
			foreignColumns: [workflow.id],
			name: "workflow_subflows_workflow_id_workflow_id_fk"
		}).onDelete("cascade"),
]);
