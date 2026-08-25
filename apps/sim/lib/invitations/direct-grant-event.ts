export const DIRECT_GRANT_EMAIL_EVENT_TYPE = 'invitation.send-workspace-added'

export interface DirectGrantEmailPayload {
  email: string
  inviterName: string
  workspaceId: string
  workspaceName: string
  sourceOperationId?: string
}
