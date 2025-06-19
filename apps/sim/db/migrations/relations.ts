import { relations } from "drizzle-orm/relations";
import { user, account, workflow, workflowBroadcastConnections, environment, webhook, workflowLogs, apiKey, marketplace, customTools, session, organization, invitation, member, chat, settings, workspace, workspaceMember, workspaceInvitation, userStats, workflowFolder, workflowSchedule, memory, knowledgeBase, document, embedding, workflowBlocks, workflowEdges, workflowSubflows } from "./schema";

export const accountRelations = relations(account, ({one}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	accounts: many(account),
	environments: many(environment),
	apiKeys: many(apiKey),
	marketplaces: many(marketplace),
	customTools: many(customTools),
	sessions: many(session),
	invitations: many(invitation),
	members: many(member),
	chats: many(chat),
	settings: many(settings),
	workspaces: many(workspace),
	workspaceMembers: many(workspaceMember),
	workspaceInvitations: many(workspaceInvitation),
	userStats: many(userStats),
	workflows: many(workflow),
	knowledgeBases: many(knowledgeBase),
	workflowFolders: many(workflowFolder),
}));

export const workflowBroadcastConnectionsRelations = relations(workflowBroadcastConnections, ({one}) => ({
	workflow: one(workflow, {
		fields: [workflowBroadcastConnections.workflowId],
		references: [workflow.id]
	}),
}));

export const workflowRelations = relations(workflow, ({one, many}) => ({
	workflowBroadcastConnections: many(workflowBroadcastConnections),
	webhooks: many(webhook),
	workflowLogs: many(workflowLogs),
	marketplaces: many(marketplace),
	chats: many(chat),
	user: one(user, {
		fields: [workflow.userId],
		references: [user.id]
	}),
	workspace: one(workspace, {
		fields: [workflow.workspaceId],
		references: [workspace.id]
	}),
	workflowFolder: one(workflowFolder, {
		fields: [workflow.folderId],
		references: [workflowFolder.id]
	}),
	workflowSchedules: many(workflowSchedule),
	memories: many(memory),
	workflowBlocks: many(workflowBlocks),
	workflowEdges: many(workflowEdges),
	workflowSubflows: many(workflowSubflows),
}));

export const environmentRelations = relations(environment, ({one}) => ({
	user: one(user, {
		fields: [environment.userId],
		references: [user.id]
	}),
}));

export const webhookRelations = relations(webhook, ({one}) => ({
	workflow: one(workflow, {
		fields: [webhook.workflowId],
		references: [workflow.id]
	}),
}));

export const workflowLogsRelations = relations(workflowLogs, ({one}) => ({
	workflow: one(workflow, {
		fields: [workflowLogs.workflowId],
		references: [workflow.id]
	}),
}));

export const apiKeyRelations = relations(apiKey, ({one}) => ({
	user: one(user, {
		fields: [apiKey.userId],
		references: [user.id]
	}),
}));

export const marketplaceRelations = relations(marketplace, ({one}) => ({
	workflow: one(workflow, {
		fields: [marketplace.workflowId],
		references: [workflow.id]
	}),
	user: one(user, {
		fields: [marketplace.authorId],
		references: [user.id]
	}),
}));

export const customToolsRelations = relations(customTools, ({one}) => ({
	user: one(user, {
		fields: [customTools.userId],
		references: [user.id]
	}),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
	organization: one(organization, {
		fields: [session.activeOrganizationId],
		references: [organization.id]
	}),
}));

export const organizationRelations = relations(organization, ({many}) => ({
	sessions: many(session),
	invitations: many(invitation),
	members: many(member),
}));

export const invitationRelations = relations(invitation, ({one}) => ({
	user: one(user, {
		fields: [invitation.inviterId],
		references: [user.id]
	}),
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id]
	}),
}));

export const memberRelations = relations(member, ({one}) => ({
	user: one(user, {
		fields: [member.userId],
		references: [user.id]
	}),
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id]
	}),
}));

export const chatRelations = relations(chat, ({one}) => ({
	workflow: one(workflow, {
		fields: [chat.workflowId],
		references: [workflow.id]
	}),
	user: one(user, {
		fields: [chat.userId],
		references: [user.id]
	}),
}));

export const settingsRelations = relations(settings, ({one}) => ({
	user: one(user, {
		fields: [settings.userId],
		references: [user.id]
	}),
}));

export const workspaceRelations = relations(workspace, ({one, many}) => ({
	user: one(user, {
		fields: [workspace.ownerId],
		references: [user.id]
	}),
	workspaceMembers: many(workspaceMember),
	workspaceInvitations: many(workspaceInvitation),
	workflows: many(workflow),
	knowledgeBases: many(knowledgeBase),
	workflowFolders: many(workflowFolder),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({one}) => ({
	workspace: one(workspace, {
		fields: [workspaceMember.workspaceId],
		references: [workspace.id]
	}),
	user: one(user, {
		fields: [workspaceMember.userId],
		references: [user.id]
	}),
}));

export const workspaceInvitationRelations = relations(workspaceInvitation, ({one}) => ({
	workspace: one(workspace, {
		fields: [workspaceInvitation.workspaceId],
		references: [workspace.id]
	}),
	user: one(user, {
		fields: [workspaceInvitation.inviterId],
		references: [user.id]
	}),
}));

export const userStatsRelations = relations(userStats, ({one}) => ({
	user: one(user, {
		fields: [userStats.userId],
		references: [user.id]
	}),
}));

export const workflowFolderRelations = relations(workflowFolder, ({one, many}) => ({
	workflows: many(workflow),
	user: one(user, {
		fields: [workflowFolder.userId],
		references: [user.id]
	}),
	workspace: one(workspace, {
		fields: [workflowFolder.workspaceId],
		references: [workspace.id]
	}),
}));

export const workflowScheduleRelations = relations(workflowSchedule, ({one}) => ({
	workflow: one(workflow, {
		fields: [workflowSchedule.workflowId],
		references: [workflow.id]
	}),
}));

export const memoryRelations = relations(memory, ({one}) => ({
	workflow: one(workflow, {
		fields: [memory.workflowId],
		references: [workflow.id]
	}),
}));

export const knowledgeBaseRelations = relations(knowledgeBase, ({one, many}) => ({
	user: one(user, {
		fields: [knowledgeBase.userId],
		references: [user.id]
	}),
	workspace: one(workspace, {
		fields: [knowledgeBase.workspaceId],
		references: [workspace.id]
	}),
	documents: many(document),
	embeddings: many(embedding),
}));

export const documentRelations = relations(document, ({one, many}) => ({
	knowledgeBase: one(knowledgeBase, {
		fields: [document.knowledgeBaseId],
		references: [knowledgeBase.id]
	}),
	embeddings: many(embedding),
}));

export const embeddingRelations = relations(embedding, ({one}) => ({
	knowledgeBase: one(knowledgeBase, {
		fields: [embedding.knowledgeBaseId],
		references: [knowledgeBase.id]
	}),
	document: one(document, {
		fields: [embedding.documentId],
		references: [document.id]
	}),
}));

export const workflowBlocksRelations = relations(workflowBlocks, ({one, many}) => ({
	workflow: one(workflow, {
		fields: [workflowBlocks.workflowId],
		references: [workflow.id]
	}),
	workflowBlock: one(workflowBlocks, {
		fields: [workflowBlocks.parentId],
		references: [workflowBlocks.id],
		relationName: "workflowBlocks_parentId_workflowBlocks_id"
	}),
	workflowBlocks: many(workflowBlocks, {
		relationName: "workflowBlocks_parentId_workflowBlocks_id"
	}),
	workflowEdges_sourceBlockId: many(workflowEdges, {
		relationName: "workflowEdges_sourceBlockId_workflowBlocks_id"
	}),
	workflowEdges_targetBlockId: many(workflowEdges, {
		relationName: "workflowEdges_targetBlockId_workflowBlocks_id"
	}),
}));

export const workflowEdgesRelations = relations(workflowEdges, ({one}) => ({
	workflow: one(workflow, {
		fields: [workflowEdges.workflowId],
		references: [workflow.id]
	}),
	workflowBlock_sourceBlockId: one(workflowBlocks, {
		fields: [workflowEdges.sourceBlockId],
		references: [workflowBlocks.id],
		relationName: "workflowEdges_sourceBlockId_workflowBlocks_id"
	}),
	workflowBlock_targetBlockId: one(workflowBlocks, {
		fields: [workflowEdges.targetBlockId],
		references: [workflowBlocks.id],
		relationName: "workflowEdges_targetBlockId_workflowBlocks_id"
	}),
}));

export const workflowSubflowsRelations = relations(workflowSubflows, ({one}) => ({
	workflow: one(workflow, {
		fields: [workflowSubflows.workflowId],
		references: [workflow.id]
	}),
}));