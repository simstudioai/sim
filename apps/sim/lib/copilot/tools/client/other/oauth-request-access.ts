import { CheckCircle, Loader2, MinusCircle, PlugZap, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class OAuthRequestAccessClientTool extends BaseClientTool {
  static readonly id = 'oauth_request_access'

  private cleanupListener?: () => void

  constructor(toolCallId: string) {
    super(toolCallId, OAuthRequestAccessClientTool.id, OAuthRequestAccessClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.rejected]: { text: 'Skipped integration access', icon: MinusCircle },
      [ClientToolCallState.success]: { text: 'Integration connected', icon: CheckCircle },
      [ClientToolCallState.error]: { text: 'Failed to request integration access', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted integration access request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Connect', icon: PlugZap },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async handleAccept(): Promise<void> {
    try {
      // Move to executing (we're waiting for the user to connect an integration)
      this.setState(ClientToolCallState.executing)

      if (typeof window !== 'undefined') {
        // Listen for modal close; complete success on connection, otherwise mark skipped/rejected
        const onClosed = async (evt: Event) => {
          try {
            const detail = (evt as CustomEvent).detail as { success?: boolean }
            if (detail?.success) {
              await this.markToolComplete(200, { granted: true })
              this.setState(ClientToolCallState.success)
            } else {
              await this.markToolComplete(200, 'Tool execution was skipped by the user')
              this.setState(ClientToolCallState.rejected)
            }
          } finally {
            if (this.cleanupListener) this.cleanupListener()
            this.cleanupListener = undefined
          }
        }
        window.addEventListener(
          'oauth-integration-closed',
          onClosed as EventListener,
          {
            once: true,
          } as any
        )
        this.cleanupListener = () =>
          window.removeEventListener('oauth-integration-closed', onClosed as EventListener)

        window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'credentials' } }))
      }
    } catch (e) {
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, 'Failed to open integrations settings')
    }
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
    if (this.cleanupListener) this.cleanupListener()
    this.cleanupListener = undefined
  }

  async completeAfterConnection(): Promise<void> {
    await this.markToolComplete(200, { granted: true })
    this.setState(ClientToolCallState.success)
    if (this.cleanupListener) this.cleanupListener()
    this.cleanupListener = undefined
  }

  async execute(): Promise<void> {
    await this.handleAccept()
  }
}
