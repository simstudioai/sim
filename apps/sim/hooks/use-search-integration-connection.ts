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
  readSearchConnectionAttempt,
  SEARCH_CONNECTION_ATTEMPT_EVENT,
  SEARCH_CONNECTION_ATTEMPT_MAX_AGE_MS,
  type SearchConnectionAttempt,
  searchConnectionAttemptKey,
  writeSearchConnectionAttempt,
} from '@/lib/knowledge/search/connection-attempt'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import {
  personalSearchIntegrationKeys,
  useConnectPersonalSearchIntegration,
  usePersonalSearchIntegrations,
} from '@/hooks/queries/personal-search-integrations'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

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
  const [localError, setLocalError] = useState<string | null>(null)
  const popup = useRef<Window | null>(null)
  const starting = useRef(false)
  const callback = useRef(onConnected)
  useEffect(() => {
    callback.current = onConnected
  }, [onConnected])
  const client = useQueryClient()
  const { mutateAsync, isPending } = useConnectPersonalSearchIntegration()
  const pending = attempt?.status === 'pending'
  const connectorId = target.connectorId ?? attempt?.connectorId
  const effectiveTarget = connectorId ? { ...target, connectorId } : target
  const query = usePersonalSearchIntegrations(
    {
      organizationId,
      connectorType: target.connectorType,
      connectorId,
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
    availableTargets.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(effectiveTarget)
    )

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
      else if (data === 'connected') {
        void client.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() })
        void client.invalidateQueries({
          queryKey: searchSourceKeys.list({ kind: 'organization', organizationId }),
        })
        void client.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) })
      }
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
  }, [attempt, key, client, organizationId])

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
  const connect = useCallback(
    async (sourceConfig?: Record<string, string>) => {
      if (starting.current || isPending || connected) return
      if (pending && popup.current && !popup.current.closed) {
        popup.current.focus()
        return
      }
      const tab = window.open('about:blank', '_blank', 'width=600,height=700')
      if (!tab) {
        setLocalError('Allow pop-ups for this site to connect your account.')
        return
      }
      tab.opener = null
      popup.current = tab
      starting.current = true
      setLocalError(null)
      let next: SearchConnectionAttempt | undefined
      try {
        const fresh = await refetch()
        if (!fresh.isSuccess) throw fresh.error
        next = {
          completionId: generateId(),
          requestedAt: Date.now(),
          connectorId,
          status: 'pending',
          error: null,
        }
        writeSearchConnectionAttempt(key, next)
        const result = await mutateAsync({
          organizationId,
          target: connectorId ? { ...target, connectorId } : target,
          sourceConfig,
          oauthCompletionId: next.completionId,
        })
        const url = new URL(result.url)
        if (
          url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && url.origin === window.location.origin)
        )
          throw new Error('The provider authorization URL is invalid')
        writeSearchConnectionAttempt(key, { ...next, connectorId: result.connectorId })
        tab.location.href = url.href
        return true
      } catch (error) {
        tab.close()
        const message = getErrorMessage(error, 'Could not start the connection')
        if (next) writeSearchConnectionAttempt(key, { ...next, status: 'failed', error: message })
        setLocalError(message)
        return false
      } finally {
        starting.current = false
      }
    },
    [isPending, connected, pending, refetch, mutateAsync, organizationId, target, connectorId, key]
  )
  const cancel = useCallback(() => {
    popup.current?.close()
    if (attempt?.status === 'pending')
      writeSearchConnectionAttempt(key, {
        ...attempt,
        status: 'failed',
        error: 'Connection canceled. You can try again.',
      })
  }, [attempt, key])
  const completeSetup = useCallback(
    (result: { connectorId: string; credentialId: string }) => {
      writeSearchConnectionAttempt(key, {
        completionId: generateId(),
        requestedAt: Date.now(),
        connectorId: result.connectorId,
        credentialId: result.credentialId,
        status: 'connected',
        error: null,
      })
    },
    [key]
  )
  return {
    completeSetup,
    connect,
    cancel,
    inventoryError: query.error?.message,
    connected,
    connectorId,
    pending,
    available,
    isStarting: isPending,
    isLoading: query.isPending,
    error: localError ?? query.error?.message ?? attempt?.error,
    retry: query.refetch,
  }
}
