'use client'

import { useEffect, useRef } from 'react'
import {
  type CredentialGroupOAuthFailure,
  credentialGroupOAuthCompletionChannel,
} from '@/lib/credential-groups/oauth-completion'
import { finishDesktopSourceBrowser } from '@/lib/desktop/source-browser'

interface CredentialGroupCompletionHandoffProps {
  completionId: string
  failure?: CredentialGroupOAuthFailure
  returnHref?: string
}

/** Notifies the originating tab even when provider navigation has removed window.opener. */
export function CredentialGroupCompletionHandoff({
  completionId,
  failure,
  returnHref,
}: CredentialGroupCompletionHandoffProps) {
  const started = useRef<boolean>(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void finishDesktopSourceBrowser({ kind: 'completion', id: completionId, error: failure }).then(
      (returned) => {
        if (returned) return
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(completionId))
          channel.postMessage(failure ?? 'connected')
          channel.close()
        }
        /** Keep failures visible when the initiating window is no longer available. */
        if (!failure) {
          window.close()
          if (returnHref && !window.closed) window.location.replace(returnHref)
        }
      }
    )
  }, [completionId, failure, returnHref])
  return null
}
