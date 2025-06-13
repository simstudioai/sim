import { relations } from 'drizzle-orm/relations'
import {
  account,
  apiKey,
  chat,
  customTools,
  document,
  embedding,
  environment,
  invitation,
  knowledgeBase,
  marketplace,
  member,
  memory,
  organization,
  session,
  settings,
  user,
  userStats,
  webhook,
  workflow,
  workflowFolder,
  workflowLogs,
  workflowSchedule,
  workspace,
  workspaceInvitation,
  workspaceMember,
} from './schema'

export const customToolsRelations = relations(customTools, ({ one }) => ({
  user: one(user, {
    fields: [customTools.userId],
    references: [user.id],
  }),
}))

export const userRelations = relations(user, ({ many }) => ({
  customTools: many(customTools),
  apiKeys: many(apiKey),
  accounts: many(account),
  sessions: many(session),
  environments: many(environment),
  userStats: many(userStats),
  invitations: many(invitation),
  members: many(member),
  workspaces: many(workspace),
  workspaceMembers: many(workspaceMember),
  workflows: many(workflow),
  workspaceInvitations: many(workspaceInvitation),
  chats: many(chat),
  settings: many(settings),
  knowledgeBases: many(knowledgeBase),
  marketplaces: many(marketplace),
  workflowFolders: many(workflowFolder),
}))

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  user: one(user, {
    fields: [apiKey.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  organization: one(organization, {
    fields: [session.activeOrganizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const organizationRelations = relations(organization, ({ many }) => ({
  sessions: many(session),
  invitations: many(invitation),
  members: many(member),
}))

export const environmentRelations = relations(environment, ({ one }) => ({
  user: one(user, {
    fields: [environment.userId],
    references: [user.id],
  }),
}))

export const userStatsRelations = relations(userStats, ({ one }) => ({
  user: one(user, {
    fields: [userStats.userId],
    references: [user.id],
  }),
}))

export const webhookRelations = relations(webhook, ({ one }) => ({
  workflow: one(workflow, {
    fields: [webhook.workflowId],
    references: [workflow.id],
  }),
}))

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  webhooks: many(webhook),
  workflowSchedules: many(workflowSchedule),
  workflowLogs: many(workflowLogs),
  workflowFolder: one(workflowFolder, {
    fields: [workflow.folderId],
    references: [workflowFolder.id],
  }),
  user: one(user, {
    fields: [workflow.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [workflow.workspaceId],
    references: [workspace.id],
  }),
  chats: many(chat),
  memories: many(memory),
  marketplaces: many(marketplace),
}))

export const workflowScheduleRelations = relations(workflowSchedule, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowSchedule.workflowId],
    references: [workflow.id],
  }),
}))

export const workflowLogsRelations = relations(workflowLogs, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowLogs.workflowId],
    references: [workflow.id],
  }),
}))

export const documentRelations = relations(document, ({ one, many }) => ({
  knowledgeBase: one(knowledgeBase, {
    fields: [document.knowledgeBaseId],
    references: [knowledgeBase.id],
  }),
  embeddings: many(embedding),
}))

export const knowledgeBaseRelations = relations(knowledgeBase, ({ one, many }) => ({
  documents: many(document),
  embeddings: many(embedding),
  user: one(user, {
    fields: [knowledgeBase.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [knowledgeBase.workspaceId],
    references: [workspace.id],
  }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
}))

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  user: one(user, {
    fields: [workspace.ownerId],
    references: [user.id],
  }),
  workspaceMembers: many(workspaceMember),
  workflows: many(workflow),
  workspaceInvitations: many(workspaceInvitation),
  knowledgeBases: many(knowledgeBase),
  workflowFolders: many(workflowFolder),
}))

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  user: one(user, {
    fields: [workspaceMember.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [workspaceMember.workspaceId],
    references: [workspace.id],
  }),
}))

export const workflowFolderRelations = relations(workflowFolder, ({ one, many }) => ({
  workflows: many(workflow),
  user: one(user, {
    fields: [workflowFolder.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [workflowFolder.workspaceId],
    references: [workspace.id],
  }),
}))

export const workspaceInvitationRelations = relations(workspaceInvitation, ({ one }) => ({
  user: one(user, {
    fields: [workspaceInvitation.inviterId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [workspaceInvitation.workspaceId],
    references: [workspace.id],
  }),
}))

export const chatRelations = relations(chat, ({ one }) => ({
  user: one(user, {
    fields: [chat.userId],
    references: [user.id],
  }),
  workflow: one(workflow, {
    fields: [chat.workflowId],
    references: [workflow.id],
  }),
}))

export const embeddingRelations = relations(embedding, ({ one }) => ({
  document: one(document, {
    fields: [embedding.documentId],
    references: [document.id],
  }),
  knowledgeBase: one(knowledgeBase, {
    fields: [embedding.knowledgeBaseId],
    references: [knowledgeBase.id],
  }),
}))

export const memoryRelations = relations(memory, ({ one }) => ({
  workflow: one(workflow, {
    fields: [memory.workflowId],
    references: [workflow.id],
  }),
}))

export const settingsRelations = relations(settings, ({ one }) => ({
  user: one(user, {
    fields: [settings.userId],
    references: [user.id],
  }),
}))

export const marketplaceRelations = relations(marketplace, ({ one }) => ({
  user: one(user, {
    fields: [marketplace.authorId],
    references: [user.id],
  }),
  workflow: one(workflow, {
    fields: [marketplace.workflowId],
    references: [workflow.id],
  }),
}))
