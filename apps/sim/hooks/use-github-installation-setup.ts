'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import type { StartGitHubSearchSetupBody } from '@/lib/api/contracts/knowledge/github-setup'
import {
  credentialGroupOAuthCompletionChannel,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import { resolveGitHubSetupUrl } from '@/lib/knowledge/github-setup-navigation'
import { githubSearchInstallationKeys } from '@/hooks/queries/github-search-installations'
import {
  isGitHubSetupTerminalError,
  useCancelGitHubSearchSetup,
  useGitHubSearchSetup,
  useStartGitHubSearchSetup,
} from '@/hooks/queries/github-search-setup'
import { oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'

interface GitHubInstallationSetupProps {
  organizationId?: string
  onConnected: (credentialId: string) => void
}

/** Keeps the source form in place; only an authorized server result completes setup. */
export function useGitHubInstallationSetup({
  organizationId,
  onConnected,
}: GitHubInstallationSetupProps) {
  const active = useRef<{ setupId: string; tab: Window } | null>(null)
  const callback = useRef(onConnected)
  const [setupId, setSetupId] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [previousOrganizationId, setPreviousOrganizationId] = useState(organizationId)
  if (previousOrganizationId !== organizationId) {
    setPreviousOrganizationId(organizationId)
    setSetupId(undefined)
    setError(null)
  }
  const client = useQueryClient()
  const { mutateAsync: start, isPending: isStarting } = useStartGitHubSearchSetup()
  const { mutateAsync: cancelSetup } = useCancelGitHubSearchSetup()
  const scope = organizationId && setupId ? { organizationId, setupId } : undefined
  const query = useGitHubSearchSetup(scope)
  const { refetch } = query

  useEffect(() => {
    callback.current = onConnected
  }, [onConnected])

  useEffect(() => {
    return () => {
      const attempt = active.current
      active.current = null
      attempt?.tab.close()
      if (attempt && organizationId)
        void cancelSetup({ organizationId, setupId: attempt.setupId }).catch(() => undefined)
    }
  }, [organizationId, cancelSetup])

  useEffect(() => {
    if (!setupId || !organizationId) return
    const fail = (message: string) => {
      if (active.current?.setupId !== setupId) return
      active.current.tab.close()
      active.current = null
      setSetupId(undefined)
      setError(message)
      void cancelSetup({ organizationId, setupId }).catch(() => undefined)
    }
    const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(setupId))
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (isCredentialGroupOAuthFailure(data) || data === 'connected') void refetch()
    }
    const timer = window.setTimeout(
      () => fail('GitHub connection timed out. Try connecting again.'),
      10 * 60_000
    )
    return () => {
      channel.close()
      window.clearTimeout(timer)
    }
  }, [organizationId, setupId, cancelSetup, refetch])

  useEffect(() => {
    if (!setupId || !organizationId || active.current?.setupId !== setupId) return
    const result = query.data
    if (result?.status === 'completed') {
      active.current.tab.close()
      active.current = null
      setSetupId(undefined)
      for (const purpose of [undefined, 'browsing'] as const) {
        void client.invalidateQueries({
          queryKey: oauthCredentialKeys.list(
            'github-repositories',
            '',
            '',
            organizationId,
            purpose
          ),
        })
      }
      void client.invalidateQueries({ queryKey: githubSearchInstallationKeys.list(organizationId) })
      void client.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) })
      callback.current(result.credential.id)
    } else if (
      isGitHubSetupTerminalError(query.error) ||
      result?.status === 'failed' ||
      result?.status === 'expired'
    ) {
      active.current.tab.close()
      active.current = null
      setSetupId(undefined)
      setError(
        query.error?.message ??
          (result?.status === 'failed'
            ? result.error
            : 'This GitHub connection attempt expired. Try connecting again.')
      )
      void cancelSetup({ organizationId, setupId }).catch(() => undefined)
    }
  }, [query.data, query.error, setupId, organizationId, client, cancelSetup])

  const connect = useCallback(
    async (intent?: StartGitHubSearchSetupBody['intent']) => {
      if (!organizationId) return
      if (active.current) {
        active.current.tab.focus()
        return
      }
      const tab = window.open('about:blank', '_blank', 'width=600,height=700')
      if (!tab) {
        setError('Allow pop-ups for this site to connect GitHub, then try again.')
        return
      }
      tab.opener = null
      const id = generateId()
      active.current = { setupId: id, tab }
      setError(null)
      try {
        const result = await start({ organizationId, setupId: id, ...(intent ? { intent } : {}) })
        if (active.current?.setupId !== id) return
        const url = resolveGitHubSetupUrl(result.url, window.location.origin)
        setSetupId(id)
        tab.location.href = url
      } catch (failure) {
        if (active.current?.setupId !== id) return
        tab.close()
        active.current = null
        setSetupId(undefined)
        setError(getErrorMessage(failure, 'Could not connect GitHub'))
        void cancelSetup({ organizationId, setupId: id }).catch(() => undefined)
      }
    },
    [organizationId, start, cancelSetup]
  )

  const cancel = useCallback(() => {
    const attempt = active.current
    if (!attempt || !organizationId) return
    active.current = null
    attempt.tab.close()
    setSetupId(undefined)
    setError(null)
    void cancelSetup({ organizationId, setupId: attempt.setupId }).catch(() => undefined)
  }, [organizationId, cancelSetup])

  return { connect, cancel, pending: isStarting || Boolean(setupId), error }
}
