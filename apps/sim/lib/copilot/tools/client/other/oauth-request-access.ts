import { createLogger } from '@sim/logger'
import { CheckCircle, Loader2, MinusCircle, PlugZap, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { OAUTH_PROVIDERS, type OAuthServiceConfig } from '@/lib/oauth'

const logger = createLogger('OAuthRequestAccessClientTool')

interface OAuthRequestAccessArgs {
  providerName?: string
}

interface ResolvedServiceInfo {
  serviceId: string
  providerId: string
  service: OAuthServiceConfig
}

/**
 * Finds the service configuration from a provider name.
 * The providerName should match the exact `name` field returned by get_credentials tool's notConnected services.
 */
function findServiceByName(providerName: string): ResolvedServiceInfo | null {
  const normalizedName = providerName.toLowerCase().trim()

  // First pass: exact match (case-insensitive)
  for (const [, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(providerConfig.services)) {
      if (service.name.toLowerCase() === normalizedName) {
        return { serviceId, providerId: service.providerId, service }
      }
    }
  }

  // Second pass: partial match as fallback for flexibility
  for (const [, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(providerConfig.services)) {
      if (
        service.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(service.name.toLowerCase())
      ) {
        return { serviceId, providerId: service.providerId, service }
      }
    }
  }

  return null
}

export interface OAuthConnectEventDetail {
  providerName: string
  serviceId: string
  providerId: string
  requiredScopes: string[]
  newScopes?: string[]
}

export class OAuthRequestAccessClientTool extends BaseClientTool {
  static readonly id = 'oauth_request_access'

  private providerName?: string

  constructor(toolCallId: string) {
    super(toolCallId, OAuthRequestAccessClientTool.id, OAuthRequestAccessClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.rejected]: { text: 'Skipped integration access', icon: MinusCircle },
      [ClientToolCallState.success]: { text: 'Requested integration access', icon: CheckCircle },
      [ClientToolCallState.error]: { text: 'Failed to request integration access', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted integration access request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Connect', icon: PlugZap },
      reject: { text: 'Skip', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      if (params.providerName) {
        const name = params.providerName
        switch (state) {
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
          case ClientToolCallState.executing:
            return `Requesting ${name} access`
          case ClientToolCallState.rejected:
            return `Skipped ${name} access`
          case ClientToolCallState.success:
            return `Requested ${name} access`
          case ClientToolCallState.error:
            return `Failed to request ${name} access`
          case ClientToolCallState.aborted:
            return `Aborted ${name} access request`
        }
      }
      return undefined
    },
  }

  async handleAccept(args?: OAuthRequestAccessArgs): Promise<void> {
    try {
      if (args?.providerName) {
        this.providerName = args.providerName
      }

      if (!this.providerName) {
        logger.error('No provider name provided')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No provider name specified')
        return
      }

      // Find the service by name
      const serviceInfo = findServiceByName(this.providerName)
      if (!serviceInfo) {
        logger.error('Could not find OAuth service for provider', {
          providerName: this.providerName,
        })
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, `Unknown provider: ${this.providerName}`)
        return
      }

      const { serviceId, providerId, service } = serviceInfo

      logger.info('Opening OAuth connect modal', {
        providerName: this.providerName,
        serviceId,
        providerId,
      })

      // Move to executing state
      this.setState(ClientToolCallState.executing)

      // Dispatch event to open the OAuth modal (same pattern as open-settings)
      window.dispatchEvent(
        new CustomEvent<OAuthConnectEventDetail>('open-oauth-connect', {
          detail: {
            providerName: this.providerName,
            serviceId,
            providerId,
            requiredScopes: service.scopes || [],
          },
        })
      )

      // Mark as success - the user opened the prompt, but connection is not guaranteed
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(
        200,
        `The user opened the ${this.providerName} connection prompt and may have connected. Check the connected integrations to verify the connection status.`
      )
    } catch (e) {
      logger.error('Failed to open OAuth connect modal', { error: e })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, 'Failed to open OAuth connection dialog')
    }
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async execute(args?: OAuthRequestAccessArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
