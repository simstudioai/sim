import { relations } from 'drizzle-orm/relations'
import {
  account,
  apiKey,
  chat,
  copilotChats,
  copilotCheckpoints,
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
  permissions,
  session,
  settings,
  templateStars,
  templates,
  user,
  userRateLimits,
  userStats,
  webhook,
  workflow,
  workflowBlocks,
  workflowEdges,
  workflowExecutionBlocks,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workflowFolder,
  workflowLogs,
  workflowSchedule,
  workflowSubflows,
  workspace,
  workspaceInvitation,
} from './schema'

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  environments: many(environment),
  apiKeys: many(apiKey),
  marketplaces: many(marketplace),
  customTools: many(customTools),
  sessions: many(session),
  invitations: many(invitation),
  members: many(member),
  chats: many(chat),
  workspaces: many(workspace),
  knowledgeBases: many(knowledgeBase),
  workflows: many(workflow),
  workflowFolders: many(workflowFolder),
  workspaceInvitations: many(workspaceInvitation),
  permissions: many(permissions),
  userStats: many(userStats),
  copilotChats: many(copilotChats),
  templateStars: many(templateStars),
  templates: many(templates),
  settings: many(settings),
  userRateLimits: many(userRateLimits),
  copilotCheckpoints: many(copilotCheckpoints),
}))

export const environmentRelations = relations(environment, ({ one }) => ({
  user: one(user, {
    fields: [environment.userId],
    references: [user.id],
  }),
}))

export const workflowLogsRelations = relations(workflowLogs, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowLogs.workflowId],
    references: [workflow.id],
  }),
}))

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  workflowLogs: many(workflowLogs),
  marketplaces: many(marketplace),
  chats: many(chat),
  memories: many(memory),
  user: one(user, {
    fields: [workflow.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [workflow.workspaceId],
    references: [workspace.id],
  }),
  workflowFolder: one(workflowFolder, {
    fields: [workflow.folderId],
    references: [workflowFolder.id],
  }),
  workflowEdges: many(workflowEdges),
  workflowSubflows: many(workflowSubflows),
  workflowBlocks: many(workflowBlocks),
  workflowExecutionBlocks: many(workflowExecutionBlocks),
  workflowExecutionLogs: many(workflowExecutionLogs),
  workflowExecutionSnapshots: many(workflowExecutionSnapshots),
  copilotChats: many(copilotChats),
  templates: many(templates),
  webhooks: many(webhook),
  workflowSchedules: many(workflowSchedule),
  copilotCheckpoints: many(copilotCheckpoints),
}))

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  user: one(user, {
    fields: [apiKey.userId],
    references: [user.id],
  }),
}))

export const marketplaceRelations = relations(marketplace, ({ one }) => ({
  workflow: one(workflow, {
    fields: [marketplace.workflowId],
    references: [workflow.id],
  }),
  user: one(user, {
    fields: [marketplace.authorId],
    references: [user.id],
  }),
}))

export const customToolsRelations = relations(customTools, ({ one }) => ({
  user: one(user, {
    fields: [customTools.userId],
    references: [user.id],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [session.activeOrganizationId],
    references: [organization.id],
  }),
}))

export const organizationRelations = relations(organization, ({ many }) => ({
  sessions: many(session),
  invitations: many(invitation),
  members: many(member),
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
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
}))

export const chatRelations = relations(chat, ({ one }) => ({
  workflow: one(workflow, {
    fields: [chat.workflowId],
    references: [workflow.id],
  }),
  user: one(user, {
    fields: [chat.userId],
    references: [user.id],
  }),
}))

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  user: one(user, {
    fields: [workspace.ownerId],
    references: [user.id],
  }),
  knowledgeBases: many(knowledgeBase),
  workflows: many(workflow),
  workflowFolders: many(workflowFolder),
  workspaceInvitations: many(workspaceInvitation),
}))

export const memoryRelations = relations(memory, ({ one }) => ({
  workflow: one(workflow, {
    fields: [memory.workflowId],
    references: [workflow.id],
  }),
}))

export const knowledgeBaseRelations = relations(knowledgeBase, ({ one, many }) => ({
  user: one(user, {
    fields: [knowledgeBase.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [knowledgeBase.workspaceId],
    references: [workspace.id],
  }),
  documents: many(document),
  embeddings: many(embedding),
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

export const workflowEdgesRelations = relations(workflowEdges, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowEdges.workflowId],
    references: [workflow.id],
  }),
  workflowBlock_sourceBlockId: one(workflowBlocks, {
    fields: [workflowEdges.sourceBlockId],
    references: [workflowBlocks.id],
    relationName: 'workflowEdges_sourceBlockId_workflowBlocks_id',
  }),
  workflowBlock_targetBlockId: one(workflowBlocks, {
    fields: [workflowEdges.targetBlockId],
    references: [workflowBlocks.id],
    relationName: 'workflowEdges_targetBlockId_workflowBlocks_id',
  }),
}))

export const workflowBlocksRelations = relations(workflowBlocks, ({ one, many }) => ({
  workflowEdges_sourceBlockId: many(workflowEdges, {
    relationName: 'workflowEdges_sourceBlockId_workflowBlocks_id',
  }),
  workflowEdges_targetBlockId: many(workflowEdges, {
    relationName: 'workflowEdges_targetBlockId_workflowBlocks_id',
  }),
  workflow: one(workflow, {
    fields: [workflowBlocks.workflowId],
    references: [workflow.id],
  }),
  webhooks: many(webhook),
  workflowSchedules: many(workflowSchedule),
}))

export const workflowSubflowsRelations = relations(workflowSubflows, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowSubflows.workflowId],
    references: [workflow.id],
  }),
}))

export const workspaceInvitationRelations = relations(workspaceInvitation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceInvitation.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceInvitation.inviterId],
    references: [user.id],
  }),
}))

export const permissionsRelations = relations(permissions, ({ one }) => ({
  user: one(user, {
    fields: [permissions.userId],
    references: [user.id],
  }),
}))

export const userStatsRelations = relations(userStats, ({ one }) => ({
  user: one(user, {
    fields: [userStats.userId],
    references: [user.id],
  }),
}))

export const workflowExecutionBlocksRelations = relations(workflowExecutionBlocks, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowExecutionBlocks.workflowId],
    references: [workflow.id],
  }),
}))

export const workflowExecutionLogsRelations = relations(workflowExecutionLogs, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowExecutionLogs.workflowId],
    references: [workflow.id],
  }),
  workflowExecutionSnapshot: one(workflowExecutionSnapshots, {
    fields: [workflowExecutionLogs.stateSnapshotId],
    references: [workflowExecutionSnapshots.id],
  }),
}))

export const workflowExecutionSnapshotsRelations = relations(
  workflowExecutionSnapshots,
  ({ one, many }) => ({
    workflowExecutionLogs: many(workflowExecutionLogs),
    workflow: one(workflow, {
      fields: [workflowExecutionSnapshots.workflowId],
      references: [workflow.id],
    }),
  })
)

export const copilotChatsRelations = relations(copilotChats, ({ one, many }) => ({
  user: one(user, {
    fields: [copilotChats.userId],
    references: [user.id],
  }),
  workflow: one(workflow, {
    fields: [copilotChats.workflowId],
    references: [workflow.id],
  }),
  copilotCheckpoints: many(copilotCheckpoints),
}))

export const documentRelations = relations(document, ({ one, many }) => ({
  knowledgeBase: one(knowledgeBase, {
    fields: [document.knowledgeBaseId],
    references: [knowledgeBase.id],
  }),
  embeddings: many(embedding),
}))

export const embeddingRelations = relations(embedding, ({ one }) => ({
  knowledgeBase: one(knowledgeBase, {
    fields: [embedding.knowledgeBaseId],
    references: [knowledgeBase.id],
  }),
  document: one(document, {
    fields: [embedding.documentId],
    references: [document.id],
  }),
}))

export const templateStarsRelations = relations(templateStars, ({ one }) => ({
  user: one(user, {
    fields: [templateStars.userId],
    references: [user.id],
  }),
  template: one(templates, {
    fields: [templateStars.templateId],
    references: [templates.id],
  }),
}))

export const templatesRelations = relations(templates, ({ one, many }) => ({
  templateStars: many(templateStars),
  workflow: one(workflow, {
    fields: [templates.workflowId],
    references: [workflow.id],
  }),
  user: one(user, {
    fields: [templates.userId],
    references: [user.id],
  }),
}))

export const settingsRelations = relations(settings, ({ one }) => ({
  user: one(user, {
    fields: [settings.userId],
    references: [user.id],
  }),
}))

export const userRateLimitsRelations = relations(userRateLimits, ({ one }) => ({
  user: one(user, {
    fields: [userRateLimits.userId],
    references: [user.id],
  }),
}))

export const webhookRelations = relations(webhook, ({ one }) => ({
  workflow: one(workflow, {
    fields: [webhook.workflowId],
    references: [workflow.id],
  }),
  workflowBlock: one(workflowBlocks, {
    fields: [webhook.blockId],
    references: [workflowBlocks.id],
  }),
}))

export const workflowScheduleRelations = relations(workflowSchedule, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowSchedule.workflowId],
    references: [workflow.id],
  }),
  workflowBlock: one(workflowBlocks, {
    fields: [workflowSchedule.blockId],
    references: [workflowBlocks.id],
  }),
}))

export const copilotCheckpointsRelations = relations(copilotCheckpoints, ({ one }) => ({
  user: one(user, {
    fields: [copilotCheckpoints.userId],
    references: [user.id],
  }),
  workflow: one(workflow, {
    fields: [copilotCheckpoints.workflowId],
    references: [workflow.id],
  }),
  copilotChat: one(copilotChats, {
    fields: [copilotCheckpoints.chatId],
    references: [copilotChats.id],
  }),
}))
