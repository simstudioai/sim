import { BaseCopilotTool } from '@/lib/copilot/tools/server-tools/base'

type GDriveRequestAccessParams = Record<string, never>

interface GDriveRequestAccessResult {
  message: string
}

class GDriveRequestAccessServerTool extends BaseCopilotTool<
  GDriveRequestAccessParams,
  GDriveRequestAccessResult
> {
  readonly id = 'gdrive_request_access'
  readonly displayName = 'Requesting Google Drive access'
  // Do not require interrupt on server; client handled the interrupt/approval
  readonly requiresInterrupt = false

  protected async executeImpl(
    _params: GDriveRequestAccessParams
  ): Promise<GDriveRequestAccessResult> {
    return { message: 'Google Drive access confirmed by user' }
  }
}

export const gdriveRequestAccessServerTool = new GDriveRequestAccessServerTool()
