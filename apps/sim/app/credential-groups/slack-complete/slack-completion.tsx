'use client'

import { useEffect, useRef } from 'react'
import { finishDesktopSourceBrowser } from '@/lib/desktop/source-browser'
import { organizationRoutes } from '@/lib/navigation/paths'

interface SlackCompletionProps {
  organizationId?: string
  mode: 'managed' | 'search'
  ok: boolean
  state?: string
  reason?: string
  credentialGroupId?: string
  slackBotCredentialId?: string
}

export function SlackCompletion({
  organizationId,
  mode,
  ok,
  state,
  reason,
  credentialGroupId,
  slackBotCredentialId,
}: SlackCompletionProps) {
  const started = useRef<boolean>(false)
  useEffect(() => {
    if (started.current || !state) return
    started.current = true
    void finishDesktopSourceBrowser({
      kind: mode === 'managed' ? 'slack-managed-users' : 'slack-search',
      id: state,
      ...(ok ? {} : { error: reason ?? 'failed' }),
    }).then((returned) => {
      if (returned) return
      if (mode === 'search') {
        if (ok && organizationId) {
          const url = new URL(
            organizationRoutes(organizationId).settingsSection('search-slack'),
            window.location.origin
          )
          url.searchParams.set('slackSetup', 'complete')
          window.location.replace(url.href)
        }
        return
      }
      const channel = new BroadcastChannel('slack-managed-users')
      channel.postMessage({
        type: 'slack-managed-users',
        ok,
        state,
        reason,
        credentialGroupId,
        slackBotCredentialId,
      })
      channel.close()
      if (ok) window.close()
    })
  }, [organizationId, mode, ok, state, reason, credentialGroupId, slackBotCredentialId])
  return null
}
