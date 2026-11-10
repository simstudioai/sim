import { getErrorMessage } from '@sim/utils/errors'
import { MICROSOFT_DATAVERSE_PROVIDER_ID } from '@/lib/oauth/microsoft-dataverse'
import { useOAuthCredentialDetail } from '@/hooks/queries/oauth/credentials'
import {
  assertMicrosoftDataverseReconnectAvailable,
  useMicrosoftDataverseCredentialBinding,
} from '@/hooks/queries/oauth/microsoft-dataverse-connections'

interface ReconnectableCredential {
  id: string
  type: string
  providerId: string | null
}

/**
 * How a workspace credential reconnects when it is a Dataverse one:
 * a credential bound to an environment reconnects to that same environment, an unbound one through
 * the plain OAuth flow, and one whose binding is invalid or cannot be read does not reconnect in
 * place. Any other credential reconnects as usual.
 */
export function useDataverseReconnect(credential: ReconnectableCredential | null | undefined) {
  const applies =
    credential?.type === 'oauth' && credential.providerId === MICROSOFT_DATAVERSE_PROVIDER_ID
  const detail = useOAuthCredentialDetail(applies ? credential.id : undefined, undefined, applies)
  const binding = useMicrosoftDataverseCredentialBinding({
    isPending: detail.isPending,
    providerId: applies ? MICROSOFT_DATAVERSE_PROVIDER_ID : undefined,
    scopes: detail.data?.[0]?.scopes,
  })
  let blockedReason: string | undefined
  if (applies && !binding.isPending) {
    try {
      assertMicrosoftDataverseReconnectAvailable({
        bindingState: binding.state,
        credentialQueryFailed: detail.isError,
      })
    } catch (error) {
      blockedReason = getErrorMessage(error, 'This Dataverse credential cannot be reconnected.')
    }
  }
  return {
    pending: binding.isPending,
    blockedReason,
    environmentUrl: binding.state === 'bound' ? binding.environmentUrl : undefined,
  }
}
