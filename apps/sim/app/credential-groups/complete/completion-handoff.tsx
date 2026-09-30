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
}

/** Notifies the originating tab even when provider navigation has removed window.opener. */
export function CredentialGroupCompletionHandoff({
  completionId,
  failure,
}: CredentialGroupCompletionHandoffProps) {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void finishDesktopSourceBrowser({ kind: 'completion', id: completionId, error: failure }).then(
      (returned) => {
        if (returned) return
        const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(completionId))
        channel.postMessage(failure ?? 'connected')
        channel.close()
        /** Keep the authorization failure visible while the initiating chat shows its retry action. */
        if (!failure) window.close()
      }
    )
  }, [completionId, failure])
  return null
}
