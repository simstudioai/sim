import { toast } from '@sim/emcn'
import { toError } from '@sim/utils/errors'
import type { OrganizationAccountConnectionResponse } from '@/lib/api/contracts/organization-accounts'
import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  credentialGroupOAuthCompletionChannel,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'

const CONNECTION_TIMEOUT_MS = 10 * 60_000

/** Keeps the initiating surface open; provider window isolation is not a cancellation signal. */
export async function connectCredentialGroupInPopup(
  completionId: string,
  start: (signal: AbortSignal) => Promise<OrganizationAccountConnectionResponse>,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const popup =
    typeof BroadcastChannel === 'undefined' ? null : window.open('about:blank', '_blank')
  if (!popup) {
    const result = await start(signal)
    signal.throwIfAborted()
    window.location.assign(result.authorizationUrl ?? result.invitationLink)
    return
  }
  popup.opener = null
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(completionId))
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      controller.abort()
      clearTimeout(timer)
      channel.close()
      signal.removeEventListener('abort', abort)
      toast.dismiss(notice)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => {
      finish(new Error('Connection canceled. You can try again.'))
      popup.close()
    }
    const timer = setTimeout(() => {
      finish(new Error(CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES.expired))
    }, CONNECTION_TIMEOUT_MS)
    const notice = toast({
      message: 'Continue connecting in the authorization window',
      duration: 0,
      persistAcrossRoutes: true,
      action: { label: 'Cancel', onClick: abort },
      onUserDismiss: abort,
    })
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data === 'connected') finish()
      else if (isCredentialGroupOAuthFailure(data))
        finish(new Error(CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[data]))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    void start(controller.signal)
      .then((result) => {
        if (settled) return
        if (popup.closed) {
          abort()
          return
        }
        popup.location.replace(result.authorizationUrl ?? result.invitationLink)
      })
      .catch((error) => {
        finish(toError(error))
        popup.close()
      })
  })
}
