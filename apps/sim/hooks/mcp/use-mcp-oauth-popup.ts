'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { McpOauthCallbackMessage, McpOauthCallbackReason } from '@/lib/mcp/oauth'
import { mcpKeys, useStartMcpOauth } from '@/hooks/queries/mcp'

const logger = createLogger('useMcpOauthPopup')

function reasonToMessage(reason: McpOauthCallbackReason | undefined): string {
  switch (reason) {
    case 'provider_error':
      return 'The authorization server returned an error. Please try again.'
    case 'invalid_state':
      return 'Authorization expired. Please try again.'
    case 'user_mismatch':
      return 'You must complete authorization as the same user who started it.'
    case 'server_gone':
      return 'This MCP server no longer exists.'
    case 'insecure_url':
      return 'MCP OAuth requires https.'
    case 'token_exchange_failed':
      return 'Failed to complete token exchange with the authorization server.'
    case 'unauthenticated':
      return 'Please sign in and try again.'
    case 'missing_params':
      return 'The authorization callback was missing required parameters.'
    default:
      return 'Authorization failed. Please try again.'
  }
}

interface UseMcpOauthPopupProps {
  workspaceId: string
}

/**
 * Bounds how long a row shows "Connecting…" without a result. Matches the server-side OAuth
 * start TTL: once it lapses the authorization state has expired and the flow can no longer
 * complete, so a still-pending flow is safe to drop.
 */
const OAUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000

export function useMcpOauthPopup({ workspaceId }: UseMcpOauthPopupProps) {
  const queryClient = useQueryClient()
  const { mutateAsync: startOauth } = useStartMcpOauth()

  const [connectingServers, setConnectingServers] = useState<Set<string>>(() => new Set())
  // serverId -> safety timeout. This is the correlation source of truth for the
  // BroadcastChannel gate: it is cleared only when the flow completes or times out, never by
  // popup.closed polling — COOP can make popup.closed misreport, and clearing it early would
  // drop the genuine completion this fix exists to deliver.
  const pendingFlowsRef = useRef<Map<string, number>>(new Map())
  // serverId -> popup.closed poll. Best-effort fast "Connecting…" clear when the user
  // abandons the popup; never used to correlate a result.
  const popupPollsRef = useRef<Map<string, number>>(new Map())

  const stopConnecting = useCallback((serverId: string) => {
    setConnectingServers((prev) => {
      if (!prev.has(serverId)) return prev
      const next = new Set(prev)
      next.delete(serverId)
      return next
    })
  }, [])

  const stopPopupPoll = useCallback((serverId: string) => {
    const poll = popupPollsRef.current.get(serverId)
    if (poll !== undefined) {
      window.clearInterval(poll)
      popupPollsRef.current.delete(serverId)
    }
  }, [])

  /** End a flow entirely: stop the spinner, its safety timeout, and its popup poll. */
  const settleFlow = useCallback(
    (serverId: string) => {
      const timeout = pendingFlowsRef.current.get(serverId)
      if (timeout !== undefined) window.clearTimeout(timeout)
      pendingFlowsRef.current.delete(serverId)
      stopPopupPoll(serverId)
      stopConnecting(serverId)
    },
    [stopConnecting, stopPopupPoll]
  )

  useEffect(() => {
    const pending = pendingFlowsRef.current
    const polls = popupPollsRef.current
    return () => {
      for (const t of pending.values()) window.clearTimeout(t)
      for (const p of polls.values()) window.clearInterval(p)
      pending.clear()
      polls.clear()
    }
  }, [])

  useEffect(() => {
    // The callback signals over a same-origin BroadcastChannel (see the OAuth callback
    // route): a provider whose authorize page sets COOP `same-origin` severs
    // `window.opener`, so a popup `postMessage` can be lost and leave the row stuck on
    // "Connecting…". A BroadcastChannel is origin-scoped, so it needs no origin check.
    const channel = new BroadcastChannel('mcp-oauth')
    channel.onmessage = (event) => {
      const data = event.data as Partial<McpOauthCallbackMessage> | null
      if (data?.type !== 'mcp-oauth') return
      // A BroadcastChannel reaches every same-origin tab, so react only to a result for a
      // flow THIS tab started. A result without a serverId can't be correlated to a flow, so
      // it's ignored here — the initiating tab's safety timeout clears its own "Connecting…".
      if (!data.serverId || !pendingFlowsRef.current.has(data.serverId)) return
      settleFlow(data.serverId)
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) })
        queryClient.invalidateQueries({
          queryKey: mcpKeys.serverToolsList(workspaceId, data.serverId),
        })
        queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(workspaceId) })
        toast.success('Server authorized')
      } else {
        toast.error(reasonToMessage(data.reason))
      }
    }
    return () => channel.close()
  }, [queryClient, workspaceId, settleFlow])

  const startOauthForServer = useCallback(
    async (serverId: string) => {
      setConnectingServers((prev) => new Set(prev).add(serverId))
      try {
        const result = await startOauth({ serverId, workspaceId })
        if (result.status === 'already_authorized') {
          settleFlow(serverId)
          return
        }
        const { popup } = result
        // Track this in-flight flow for the BroadcastChannel gate, bounded by a safety
        // timeout in case no result ever arrives (popup abandoned, or a callback failure
        // that couldn't carry a serverId).
        const existingTimeout = pendingFlowsRef.current.get(serverId)
        if (existingTimeout !== undefined) window.clearTimeout(existingTimeout)
        pendingFlowsRef.current.set(
          serverId,
          window.setTimeout(() => settleFlow(serverId), OAUTH_FLOW_TIMEOUT_MS)
        )
        // Best-effort: clear "Connecting…" quickly when the user closes the popup without
        // finishing. popup.closed can misreport under COOP, so this only stops the spinner —
        // it never touches `pendingFlowsRef`, so it can't drop a real result.
        stopPopupPoll(serverId)
        popupPollsRef.current.set(
          serverId,
          window.setInterval(() => {
            if (popup.closed) {
              stopPopupPoll(serverId)
              stopConnecting(serverId)
            }
          }, 500)
        )
      } catch (e) {
        settleFlow(serverId)
        logger.error('Failed to start MCP OAuth', e)
        toast.error(toError(e).message || 'Failed to start authorization')
      }
    },
    [startOauth, workspaceId, settleFlow, stopConnecting, stopPopupPoll]
  )

  return { connectingServers, startOauthForServer }
}
