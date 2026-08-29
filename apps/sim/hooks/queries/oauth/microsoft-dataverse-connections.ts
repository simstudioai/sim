import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/draft-constants'
import { getDesktopBridge } from '@/lib/desktop'
import {
  bindMicrosoftDataverseEnvironmentToOAuthCallback,
  extractMicrosoftDataverseEnvironmentUrl,
  getMicrosoftDataverseOAuthScopes,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
  normalizeMicrosoftDataverseEnvironmentUrl,
} from '@/lib/oauth/microsoft-dataverse'
import { oauthConnectionsKeys } from '@/hooks/queries/oauth/oauth-connections'

const logger = createLogger('MicrosoftDataverseOAuthConnections')

interface ConnectMicrosoftDataverseOAuthParams {
  callbackURL: string
  draftId?: string
  environmentUrl: string
}

interface MicrosoftDataverseOAuthLinkRequest {
  providerId: typeof MICROSOFT_DATAVERSE_PROVIDER_ID
  callbackURL: string
  scopes: string[]
}

export function buildMicrosoftDataverseOAuthLinkRequest({
  callbackURL,
  draftId,
  environmentUrl,
}: ConnectMicrosoftDataverseOAuthParams): MicrosoftDataverseOAuthLinkRequest {
  const environment = normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl)
  const stateCallbackUrl = new URL(callbackURL)
  if (draftId) {
    stateCallbackUrl.searchParams.set(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM, draftId)
  }
  return {
    providerId: MICROSOFT_DATAVERSE_PROVIDER_ID,
    callbackURL: bindMicrosoftDataverseEnvironmentToOAuthCallback(
      stateCallbackUrl.toString(),
      environment
    ),
    scopes: getMicrosoftDataverseOAuthScopes(environment),
  }
}

/** Fails before a credential draft is created when this web-only flow cannot start. */
export function assertMicrosoftDataverseWebOAuthAvailable(): void {
  if (getDesktopBridge()?.beginOAuthConnect) {
    throw new Error('Microsoft Dataverse connections must currently be created in the Sim web app.')
  }
}

interface AssertMicrosoftDataverseReconnectAvailableParams {
  bindingState: MicrosoftDataverseCredentialBindingState
  credentialQueryFailed: boolean
}

export function assertMicrosoftDataverseReconnectAvailable({
  bindingState,
  credentialQueryFailed,
}: AssertMicrosoftDataverseReconnectAvailableParams): void {
  if (credentialQueryFailed) {
    throw new Error(
      'Could not verify this Dataverse credential’s environment binding. Please try again.'
    )
  }
  if (bindingState === 'invalid') {
    throw new Error(
      'This Dataverse credential has an invalid environment binding and cannot be reconnected in place.'
    )
  }
  if (bindingState === 'bound') assertMicrosoftDataverseWebOAuthAvailable()
}

export function useConnectMicrosoftDataverseOAuthService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: ConnectMicrosoftDataverseOAuthParams) => {
      assertMicrosoftDataverseWebOAuthAvailable()
      const request = buildMicrosoftDataverseOAuthLinkRequest(params)

      const result = await client.oauth2.link(request)
      if (result.error) {
        throw new Error(
          getErrorMessage(
            result.error.message,
            result.error.statusText || 'Failed to start Microsoft Dataverse OAuth'
          )
        )
      }
      return { success: true }
    },
    onError: (error) => {
      logger.error('Microsoft Dataverse OAuth connection error:', error)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
    },
  })
}

export type MicrosoftDataverseCredentialBindingState =
  | 'not-dataverse'
  | 'loading'
  | 'legacy'
  | 'bound'
  | 'invalid'

interface UseMicrosoftDataverseCredentialBindingProps {
  isPending?: boolean
  providerId?: string
  scopes?: string[]
}

export function useMicrosoftDataverseCredentialBinding({
  isPending = false,
  providerId,
  scopes,
}: UseMicrosoftDataverseCredentialBindingProps) {
  const applies = providerId === MICROSOFT_DATAVERSE_PROVIDER_ID

  const binding = (() => {
    if (!applies) {
      return {
        state: 'not-dataverse' as const,
        environmentUrl: undefined,
      }
    }
    if (isPending) {
      return {
        state: 'loading' as const,
        environmentUrl: undefined,
      }
    }
    try {
      const environmentUrl = extractMicrosoftDataverseEnvironmentUrl(scopes)
      return environmentUrl
        ? { state: 'bound' as const, environmentUrl }
        : { state: 'legacy' as const, environmentUrl: undefined }
    } catch {
      return {
        state: 'invalid' as const,
        environmentUrl: undefined,
      }
    }
  })()

  return {
    ...binding,
    applies,
    isPending: binding.state === 'loading',
  }
}
