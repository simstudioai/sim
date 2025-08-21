import { Loader2, FolderOpen, MinusCircle, CheckCircle, XCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

interface GDriveAcceptContext {
  openDrivePicker: (accessToken: string) => Promise<boolean>
}

export class GDriveRequestAccessClientTool extends BaseClientTool {
  static readonly id = 'gdrive_request_access'

  constructor(toolCallId: string) {
    super(toolCallId, GDriveRequestAccessClientTool.id, GDriveRequestAccessClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing Google Drive access', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Grant Google Drive access?', icon: FolderOpen },
      [ClientToolCallState.executing]: { text: 'Requesting Google Drive access', icon: Loader2 },
      [ClientToolCallState.workflow_rejected]: { text: 'Skipped Google Drive access', icon: MinusCircle },
      [ClientToolCallState.success]: { text: 'Google Drive access granted', icon: CheckCircle },
      [ClientToolCallState.error]: { text: 'Failed to request Google Drive access', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Select', icon: FolderOpen },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  // Accept flow: fetch creds/token, then call provided openDrivePicker to get grant
  async handleAccept(ctx?: GDriveAcceptContext): Promise<void> {
    const logger = createLogger('GDriveRequestAccessClientTool')
    logger.debug('handleAccept() called', { toolCallId: this.toolCallId })

    if (!ctx?.openDrivePicker) {
      logger.error('openDrivePicker callback not provided')
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(400, 'Missing drive picker context')
      return
    }

    try {
      this.setState(ClientToolCallState.executing)

      // Fetch credentials list
      const credsRes = await fetch(`/api/auth/oauth/credentials?provider=google-drive`)
      if (!credsRes.ok) {
        throw new Error(`Failed to load OAuth credentials (${credsRes.status})`)
      }
      const credsData = await credsRes.json()
      const creds = Array.isArray(credsData.credentials) ? credsData.credentials : []
      if (creds.length === 0) {
        throw new Error('No OAuth credentials found')
      }
      const defaultCred = creds.find((c: any) => c.isDefault) || creds[0]

      // Exchange for access token
      const tokenRes = await fetch('/api/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: defaultCred.id }),
      })
      if (!tokenRes.ok) {
        throw new Error(`Failed to fetch access token (${tokenRes.status})`)
      }
      const { accessToken } = await tokenRes.json()
      if (!accessToken) {
        throw new Error('Missing access token in response')
      }

      // Open picker using provided UI callback
      const picked = await ctx.openDrivePicker(accessToken)
      if (!picked) {
        // User canceled
        await this.markToolComplete(200, 'Tool execution was skipped by the user')
        this.setState(ClientToolCallState.workflow_rejected)
        return
      }

      // Mark success
      await this.markToolComplete(200, { granted: true })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.workflow_rejected)
  }
} 