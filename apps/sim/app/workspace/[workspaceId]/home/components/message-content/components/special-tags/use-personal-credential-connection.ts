'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { useParams } from 'next/navigation'
import type { PersonalCredential } from '@/lib/api/contracts/credentials'
import {
  createOAuthChatAttempt,
  getOAuthCredentialBaseline,
  hasOAuthCredentialChanged,
  OAUTH_CHAT_ATTEMPT_EVENT,
  OAUTH_CHAT_ATTEMPT_MAX_AGE_MS,
  type OAuthChatAttempt,
  readLatestOAuthChatAttempt,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'
import { getDesktopBridge } from '@/lib/desktop'
import { resolveOAuthServiceForSlug } from '@/lib/integrations/oauth-service'
import {
  usePersonalCredentials,
  useStartPersonalCredentialConnection,
} from '@/hooks/queries/personal-credentials'

interface PersonalCredentialConnectionProps {
  provider: string
  controlId: string
  displayName: string
  onConnected?: () => void
}

function grantedCredentials(credentials: readonly PersonalCredential[]) {
  return credentials.map(({ id, providerId, connectedAt }) => ({
    id,
    providerId,
    updatedAt: connectedAt,
  }))
}

/** Personal card attempts observe only the caller's credentials, including enrollment OAuth. */
export function usePersonalCredentialConnection({
  provider,
  controlId,
  displayName,
  onConnected,
}: PersonalCredentialConnectionProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const providerId = resolveOAuthServiceForSlug(provider)?.providerId ?? provider.toLowerCase()
  const personalControlId = `personal:${controlId}`
  const [attempt, setAttempt] = useState<OAuthChatAttempt | null>(() =>
    readLatestOAuthChatAttempt({ workspaceId, providerId, controlId: personalControlId })
  )
  const pending = attempt?.status === 'pending'
  const credentials = usePersonalCredentials(workspaceId, {
    enabled: Boolean(providerId),
    refetchInterval: pending && providerId !== 'gitlab' ? 1_500 : false,
  })
  const start = useStartPersonalCredentialConnection()
  const popup = useRef<Window | null>(null)
  const starting = useRef(false)
  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected

  useEffect(() => {
    const refresh = () =>
      setAttempt(
        readLatestOAuthChatAttempt({
          workspaceId,
          providerId,
          controlId: personalControlId,
        })
      )
    window.addEventListener(OAUTH_CHAT_ATTEMPT_EVENT, refresh)
    window.addEventListener('storage', refresh)
    refresh()
    return () => {
      window.removeEventListener(OAUTH_CHAT_ATTEMPT_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [workspaceId, providerId, personalControlId])

  useEffect(() => {
    if (
      !attempt ||
      attempt.status !== 'pending' ||
      providerId === 'gitlab' ||
      !credentials.isSuccess ||
      start.isPending
    )
      return
    const records = grantedCredentials(credentials.data)
    const changed = hasOAuthCredentialChanged(attempt, records)
    const baselineGrantedAt = Date.parse(attempt.baselineCredentialUpdatedAt ?? '')
    const refreshed =
      Number.isFinite(baselineGrantedAt) &&
      records.some(
        (credential) =>
          credential.providerId === providerId &&
          Date.parse(credential.updatedAt) > baselineGrantedAt
      )
    if (changed || refreshed) setOAuthChatAttemptStatus(attempt.id, 'connected')
  }, [attempt, credentials.data, credentials.isSuccess, providerId, start.isPending])

  useEffect(() => {
    if (!attempt || attempt.status !== 'pending') return
    const timeout = window.setTimeout(
      () => {
        popup.current?.close()
        popup.current = null
        setOAuthChatAttemptStatus(attempt.id, 'failed')
      },
      Math.max(0, attempt.requestedAt + OAUTH_CHAT_ATTEMPT_MAX_AGE_MS - Date.now())
    )
    return () => window.clearTimeout(timeout)
  }, [attempt])

  useEffect(() => {
    if (attempt?.status !== 'connected') return
    popup.current?.close()
    popup.current = null
    onConnectedRef.current?.()
  }, [attempt?.status])

  const beginAttempt = useCallback(
    (records: readonly PersonalCredential[] = credentials.data ?? []) => {
      const rows = grantedCredentials(records)
      const target = { providerId, baseProviderId: providerId }
      const latestUpdate = rows.reduce(
        (latest, row) =>
          row.providerId === providerId ? Math.max(latest, Date.parse(row.updatedAt) || 0) : latest,
        0
      )
      const next = createOAuthChatAttempt({
        workspaceId,
        providerId,
        baseProviderId: providerId,
        displayName,
        controlId: personalControlId,
        ...getOAuthCredentialBaseline(target, rows),
        baselineCredentialUpdatedAt: new Date(latestUpdate).toISOString(),
      })
      setAttempt(next)
      return next
    },
    [credentials.data, workspaceId, providerId, displayName, personalControlId]
  )

  const connectOAuth = useCallback(async () => {
    if (starting.current || !credentials.isSuccess || start.isPending) return
    const desktop = getDesktopBridge()
    if (pending && popup.current && !popup.current.closed) {
      popup.current.focus()
      return
    }
    const tab = desktop?.openExternal
      ? null
      : window.open('about:blank', '_blank', 'width=600,height=700')
    if (!tab && !desktop?.openExternal) {
      toast.error('Allow pop-ups to connect your account.')
      return
    }
    if (tab) tab.opener = null
    popup.current = tab
    starting.current = true
    const fresh = await credentials.refetch({ cancelRefetch: false })
    if (!fresh.isSuccess || !fresh.data) {
      tab?.close()
      popup.current = null
      starting.current = false
      return
    }
    const next = beginAttempt(fresh.data)
    start.mutate(
      { workspaceId, providerId },
      {
        onSuccess: ({ url }) => {
          starting.current = false
          const target = new URL(url, window.location.origin)
          if (
            target.protocol !== 'https:' &&
            !(target.protocol === 'http:' && target.origin === window.location.origin)
          ) {
            tab?.close()
            popup.current = null
            setOAuthChatAttemptStatus(next.id, 'failed')
            return
          }
          if (desktop?.openExternal) {
            void desktop
              .openExternal(target.href)
              .then((opened) => {
                if (!opened) setOAuthChatAttemptStatus(next.id, 'failed')
              })
              .catch(() => setOAuthChatAttemptStatus(next.id, 'failed'))
          } else if (tab && !tab.closed) tab.location.href = target.href
        },
        onError: () => {
          starting.current = false
          tab?.close()
          popup.current = null
          setOAuthChatAttemptStatus(next.id, 'failed')
        },
      }
    )
  }, [
    credentials.isSuccess,
    credentials.refetch,
    start.isPending,
    start.mutate,
    pending,
    beginAttempt,
    workspaceId,
    providerId,
  ])

  const connectedPersonalToken = useCallback(() => {
    if (attempt) setOAuthChatAttemptStatus(attempt.id, 'connected')
    void credentials.refetch()
  }, [attempt, credentials.refetch])

  const cancelPersonalToken = useCallback(() => {
    const current = readLatestOAuthChatAttempt({
      workspaceId,
      providerId,
      controlId: personalControlId,
    })
    if (current?.status === 'pending') setOAuthChatAttemptStatus(current.id, 'failed')
  }, [workspaceId, providerId, personalControlId])

  return {
    isReady: credentials.isSuccess,
    hasMetadataError: credentials.isError,
    retryMetadata: credentials.refetch,
    isStarting: start.isPending || (starting.current && credentials.isFetching),
    status: attempt?.status ?? null,
    error: start.error?.message ?? credentials.error?.message,
    connectOAuth,
    beginPersonalToken: beginAttempt,
    connectedPersonalToken,
    cancelPersonalToken,
  }
}
