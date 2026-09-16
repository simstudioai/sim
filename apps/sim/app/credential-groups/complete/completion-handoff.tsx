'use client'

import { useEffect } from 'react'
import {
  type CredentialGroupOAuthFailure,
  credentialGroupOAuthCompletionChannel,
} from '@/lib/credential-groups/oauth-completion'

interface CredentialGroupCompletionHandoffProps {
  completionId: string
  failure?: CredentialGroupOAuthFailure
}

/** Notifies the originating tab even when provider navigation has removed window.opener. */
export function CredentialGroupCompletionHandoff({
  completionId,
  failure,
}: CredentialGroupCompletionHandoffProps) {
  useEffect(() => {
    const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(completionId))
    channel.postMessage(failure ?? 'connected')
    channel.close()
    window.close()
  }, [completionId, failure])
  return null
}
