'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { StartGitHubSearchSetupBody } from '@/lib/api/contracts/knowledge/github-setup'
import {
  credentialGroupOAuthCompletionChannel,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import { isDesktopApp } from '@/lib/desktop'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { resolveGitHubSetupUrl } from '@/lib/knowledge/github-setup-navigation'
import {
  isGitHubSetupTerminalError,
  useCancelGitHubSearchSetup,
  useGitHubSearchSetup,
  useStartGitHubSearchSetup,
} from '@/hooks/queries/github-search-setup'
import { fetchOAuthCredentials, oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'
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
  const nativeAbort = useRef<AbortController | null>(null)
  const client = useQueryClient()
  const nativeConnection = useMutation({
    mutationFn: async ({
      body,
      signal,
    }: {
      body: StartGitHubSearchSetupBody
      signal: AbortSignal
    }) => {
      const result = await connectDesktopSource({ kind: 'github-setup', body }, signal)
      const credentials = await fetchOAuthCredentials(
        { providerId: 'github-repositories', organizationId: body.organizationId },
        signal
      )
      signal.throwIfAborted()
      if (
        !result.credentialId ||
        !credentials.some((credential) => credential.id === result.credentialId)
      )
        throw new Error('GitHub is not available for this source. Try connecting again.')
      await Promise.all([
        client.invalidateQueries({ queryKey: oauthCredentialKeys.lists() }),
        client.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(body.organizationId),
        }),
      ])
      signal.throwIfAborted()
      return result.credentialId
    },
  })
  const { mutateAsync: startNative, isPending: nativePending } = nativeConnection
  const checking = useRef<string | null>(null)
  const callback = useRef(onConnected)
  const [setupId, setSetupId] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [previousOrganizationId, setPreviousOrganizationId] = useState(organizationId)
  if (previousOrganizationId !== organizationId) {
    setPreviousOrganizationId(organizationId)
    setSetupId(undefined)
    setError(null)
  }
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
      nativeAbort.current?.abort()
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
      setError(null)
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

  const checkConnection = useCallback(
    async (manual = true) => {
      const attempt = active.current
      if (!attempt || !organizationId || !setupId || checking.current === attempt.setupId) return
      let reopened = false
      if (manual && attempt.tab.closed) {
        const tab = window.open('about:blank', '_blank', 'width=600,height=700')
        if (!tab) {
          setError('Allow pop-ups for this site to continue GitHub setup, then try again.')
          return
        }
        tab.opener = null
        attempt.tab = tab
        reopened = true
      }
      checking.current = attempt.setupId
      setError(null)
      try {
        const result = await start({ organizationId, setupId: attempt.setupId })
        if (active.current !== attempt) return
        const url = resolveGitHubSetupUrl(result.url, window.location.origin)
        if (new URL(url).origin === window.location.origin) {
          if (!attempt.tab.closed) {
            attempt.tab.location.href = url
            if (manual) attempt.tab.focus()
          }
        } else if (manual) {
          if (reopened) attempt.tab.location.href = url
          setError('Finish setup on GitHub, then check the connection again.')
        }
        await refetch()
      } catch (failure) {
        if (active.current === attempt && manual)
          setError(getErrorMessage(failure, 'Could not check GitHub. Try again.'))
      } finally {
        if (checking.current === attempt.setupId) checking.current = null
      }
    },
    [organizationId, setupId, start, refetch]
  )

  useEffect(() => {
    if (!setupId) return
    const onFocus = () => void checkConnection(false)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [setupId, checkConnection])

  const connect = useCallback(
    async (intent?: StartGitHubSearchSetupBody['intent']) => {
      if (!organizationId) return
      if (isDesktopApp()) {
        if (nativeAbort.current) return
        const controller = new AbortController()
        nativeAbort.current = controller
        setError(null)
        try {
          const credentialId = await startNative({
            body: { organizationId, setupId: generateId(), ...(intent ? { intent } : {}) },
            signal: controller.signal,
          })
          callback.current(credentialId)
        } catch (failure) {
          if (!controller.signal.aborted)
            setError(getErrorMessage(failure, 'Could not connect GitHub'))
        } finally {
          if (nativeAbort.current === controller) nativeAbort.current = null
        }
        return
      }
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
    [organizationId, start, cancelSetup, startNative]
  )

  const cancel = useCallback(() => {
    nativeAbort.current?.abort()
    nativeAbort.current = null
    const attempt = active.current
    if (!attempt || !organizationId) return
    active.current = null
    attempt.tab.close()
    setSetupId(undefined)
    setError(null)
    void cancelSetup({ organizationId, setupId: attempt.setupId }).catch(() => undefined)
  }, [organizationId, cancelSetup])

  return {
    connect,
    cancel,
    checkConnection,
    isChecking: isStarting,
    pending: nativePending || isStarting || Boolean(setupId),
    error,
  }
}
