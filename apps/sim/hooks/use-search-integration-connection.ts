'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  credentialGroupOAuthCompletionChannel,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import {
  getCredentialGroupProviderService,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { isDesktopApp } from '@/lib/desktop'
import {
  readSearchConnectionAttempt,
  SEARCH_CONNECTION_ATTEMPT_EVENT,
  SEARCH_CONNECTION_ATTEMPT_MAX_AGE_MS,
  type SearchConnectionAttempt,
  searchConnectionAttemptKey,
  writeSearchConnectionAttempt,
} from '@/lib/knowledge/search/connection-attempt'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { refreshConnectedAccounts } from '@/hooks/queries/organization-accounts'
import {
  useConnectPersonalSearchIntegration,
  usePersonalSearchIntegrations,
} from '@/hooks/queries/personal-search-integrations'

interface SearchIntegrationConnectionProps {
  organizationId: string
  userId: string
  target: SearchConnectionTarget
  controlId: string
  onConnected?: () => void
}

/** OAuth stays user initiated; card completion is proved by the current personal inventory. */
export function useSearchIntegrationConnection({
  organizationId,
  userId,
  target,
  controlId,
  onConnected,
}: SearchIntegrationConnectionProps) {
  const key = searchConnectionAttemptKey(
    organizationId,
    userId,
    `${controlId}:${JSON.stringify(target)}`
  )
  const [attempt, setAttempt] = useState(() => readSearchConnectionAttempt(key))
  const [savedOpen, setSavedOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const popup = useRef<Window | null>(null)
  const starting = useRef(false)
  const nativeAbort = useRef<AbortController | null>(null)
  useEffect(() => () => nativeAbort.current?.abort(), [])
  const callback = useRef(onConnected)
  useEffect(() => {
    callback.current = onConnected
  }, [onConnected])
  const client = useQueryClient()
  const { mutateAsync, isPending } = useConnectPersonalSearchIntegration()
  const pending = attempt?.status === 'pending'
  const query = usePersonalSearchIntegrations(
    {
      organizationId,
      connectorType: target.connectorType,
      completionId: attempt?.completionId,
    },
    { pending }
  )
  const accounts = query.data?.connections.flatMap((entry) => entry.accounts) ?? []
  const connected =
    query.isSuccess &&
    attempt !== null &&
    attempt.status !== 'failed' &&
    accounts.some(
      (account) =>
        account.status === 'connected' &&
        account.credentialId ===
          (query.data?.completedCredentialId ??
            (attempt.status === 'connected' ? attempt.credentialId : undefined)) &&
        (!target.credentialId || account.credentialId === target.credentialId)
    )
  const availableTargets = [
    ...(query.data?.available.map((entry) => entry.target) ?? []),
    ...(query.data?.connections.flatMap((entry) =>
      entry.accounts.flatMap((account) => (account.action ? [account.action] : []))
    ) ?? []),
  ]
  const available =
    query.isSuccess &&
    availableTargets.some((candidate) => JSON.stringify(candidate) === JSON.stringify(target))

  useEffect(() => {
    const refresh = () => setAttempt(readSearchConnectionAttempt(key))
    window.addEventListener(SEARCH_CONNECTION_ATTEMPT_EVENT, refresh)
    window.addEventListener('storage', refresh)
    refresh()
    return () => {
      window.removeEventListener(SEARCH_CONNECTION_ATTEMPT_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [key])

  useEffect(() => {
    if (!attempt || attempt.status !== 'pending') return
    const channel = new BroadcastChannel(
      credentialGroupOAuthCompletionChannel(attempt.completionId)
    )
    const fail = (error: string) =>
      writeSearchConnectionAttempt(key, { ...attempt, status: 'failed', error })
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (isCredentialGroupOAuthFailure(data)) fail(CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[data])
      else if (data === 'connected') void refreshConnectedAccounts(client)
    }
    const timer = window.setTimeout(
      () => {
        popup.current?.close()
        fail('Connection timed out. Try connecting again.')
      },
      Math.max(0, attempt.requestedAt + SEARCH_CONNECTION_ATTEMPT_MAX_AGE_MS - Date.now())
    )
    return () => {
      channel.close()
      window.clearTimeout(timer)
    }
  }, [attempt, key, client])

  useEffect(() => {
    if (!connected || !attempt) return
    if (attempt.status !== 'connected')
      writeSearchConnectionAttempt(key, {
        ...attempt,
        status: 'connected',
        error: null,
        credentialId: query.data?.completedCredentialId ?? attempt.credentialId,
      })
    popup.current?.close()
    callback.current?.()
  }, [connected, attempt, key, query.data?.completedCredentialId])

  const { refetch } = query
  const connect = useCallback(async () => {
    if (starting.current || isPending || connected) return
    if (pending && popup.current && !popup.current.closed) {
      popup.current.focus()
      return
    }
    if (target.savedProviderId) {
      setSavedOpen(true)
      return true
    }
    const desktop = isDesktopApp()
    if (desktop && pending) return
    const tab = desktop ? null : window.open('about:blank', '_blank', 'width=600,height=700')
    if (!desktop && !tab) {
      setLocalError('Allow pop-ups for this site to connect your account.')
      return
    }
    if (tab) tab.opener = null
    popup.current = tab
    starting.current = true
    const controller = new AbortController()
    nativeAbort.current = controller
    setLocalError(null)
    let next: SearchConnectionAttempt | undefined
    try {
      if (!desktop) {
        const fresh = await refetch()
        if (!fresh.isSuccess) throw fresh.error
      }
      controller.signal.throwIfAborted()
      next = {
        completionId: generateId(),
        requestedAt: Date.now(),
        status: 'pending',
        error: null,
      }
      writeSearchConnectionAttempt(key, next)
      const result = await mutateAsync({
        organizationId,
        target,
        oauthCompletionId: next.completionId,
        signal: controller.signal,
      })
      if (!result || !tab) return true
      const url = new URL(result.url)
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && url.origin === window.location.origin)
      )
        throw new Error('The provider authorization URL is invalid')
      tab.location.href = url.href
      return true
    } catch (error) {
      tab?.close()
      const message = getErrorMessage(error, 'Could not start the connection')
      const current = readSearchConnectionAttempt(key)
      if (next && current?.completionId === next.completionId && current.status === 'pending')
        writeSearchConnectionAttempt(key, { ...current, status: 'failed', error: message })
      if (!controller.signal.aborted) setLocalError(message)
      return false
    } finally {
      starting.current = false
    }
  }, [isPending, connected, pending, refetch, mutateAsync, organizationId, target, key])
  const cancel = useCallback(() => {
    nativeAbort.current?.abort()
    popup.current?.close()
    if (attempt?.status === 'pending')
      writeSearchConnectionAttempt(key, {
        ...attempt,
        status: 'failed',
        error: 'Connection canceled. You can try again.',
      })
  }, [attempt, key])
  const closeSavedConnection = useCallback(() => setSavedOpen(false), [])
  const completeSavedConnection = useCallback(
    (credentialId: string) => {
      writeSearchConnectionAttempt(key, {
        completionId: generateId(),
        requestedAt: Date.now(),
        status: 'connected',
        credentialId,
        error: null,
      })
      setSavedOpen(false)
    },
    [key]
  )
  const connector = SEARCH_CONNECTORS.find((entry) => entry.type === target.connectorType)
  const service = isCredentialGroupProvider(target.provider)
    ? getCredentialGroupProviderService(target.provider)
    : getServiceConfigByProviderId(target.provider)
  const name = connector?.meta.name ?? service?.name ?? target.provider
  const action = target.credentialId ? 'Reconnect' : 'Connect'
  return {
    savedConnection:
      savedOpen && target.savedProviderId
        ? { providerId: target.savedProviderId, credentialId: target.credentialId }
        : null,
    closeSavedConnection,
    completeSavedConnection,
    action,
    icon: connector?.serviceIcon ?? service?.icon,
    label: connected
      ? `Connected ${name}`
      : query.isPending
        ? `Checking ${name} connections`
        : pending
          ? `Waiting for ${name} connection`
          : !available
            ? `${name} connection is no longer available`
            : `${action} ${name}`,
    disabled: query.isPending || isPending || connected || (!available && !pending),
    connect,
    cancel,
    inventoryError: query.error?.message,
    connected,
    pending,
    available,
    isStarting: isPending,
    isLoading: query.isPending,
    error: localError ?? query.error?.message ?? attempt?.error,
    retry: query.refetch,
  }
}
