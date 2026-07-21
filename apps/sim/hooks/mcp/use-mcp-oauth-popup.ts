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
  // OAuth `state` nonce -> { serverId, safety timeout }. The state keys the BroadcastChannel
  // correlation: the callback echoes it on every result (even failures that can't resolve a
  // serverId), so the tab that started this exact flow matches it while other same-origin tabs
  // ignore it. Cleared only when the flow completes or times out, never by popup.closed polling
  // — COOP can make popup.closed misreport, and clearing early would drop a genuine completion.
  const pendingFlowsRef = useRef<Map<string, { serverId: string; timeout: number }>>(new Map())
  // serverId -> popup.closed poll. Best-effort fast "Connecting…" clear when the user
  // abandons the popup; never used to correlate a result.
  const popupPollsRef = useRef<Map<string, number>>(new Map())
  // serverIds with an in-flight `/oauth/start` request. Guards a fast double-click from
  // opening two popups; cleared once the request settles, so a later click (to reopen an
  // abandoned popup) still starts a fresh flow.
  const startingRef = useRef<Set<string> | null>(null)

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

  const invalidateServer = useCallback(
    (serverId: string) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.serverToolsList(workspaceId, serverId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(workspaceId) })
    },
    [queryClient, workspaceId]
  )

  /** End a flow entirely (by its state nonce): stop the spinner, safety timeout, and popup poll. */
  const settleFlow = useCallback(
    (state: string) => {
      const flow = pendingFlowsRef.current.get(state)
      if (!flow) return
      window.clearTimeout(flow.timeout)
      pendingFlowsRef.current.delete(state)
      stopPopupPoll(flow.serverId)
      // Don't clear the spinner while a newer start for this server is in flight — that reopen
      // owns the spinner now, so a stale settle for the superseded flow must not flicker it.
      if (!startingRef.current?.has(flow.serverId)) stopConnecting(flow.serverId)
    },
    [stopConnecting, stopPopupPoll]
  )

  useEffect(() => {
    const pending = pendingFlowsRef.current
    const polls = popupPollsRef.current
    return () => {
      for (const { timeout } of pending.values()) window.clearTimeout(timeout)
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
      // A BroadcastChannel reaches every same-origin tab, so react only to a result for a flow
      // THIS tab started, matched on the OAuth `state` nonce. Every result (success or failure)
      // carries it, so unrelated tabs — and unrelated flows in this tab — ignore the broadcast.
      if (!data.state) return
      const flow = pendingFlowsRef.current.get(data.state)
      if (!flow) return
      const { serverId } = flow
      settleFlow(data.state)
      if (data.ok) {
        invalidateServer(serverId)
        toast.success('Server authorized')
      } else {
        toast.error(reasonToMessage(data.reason))
      }
    }
    return () => channel.close()
  }, [settleFlow, invalidateServer])

  const startOauthForServer = useCallback(
    async (serverId: string) => {
      const starting = (startingRef.current ??= new Set())
      if (starting.has(serverId)) return
      starting.add(serverId)
      // Whether a prior attempt for this server is still live. If the replacement `/oauth/start`
      // fails, we keep that prior flow intact so its popup can still complete and be honored.
      const hadPriorFlow = Array.from(pendingFlowsRef.current.values()).some(
        (flow) => flow.serverId === serverId
      )
      setConnectingServers((prev) => new Set(prev).add(serverId))
      try {
        const result = await startOauth({ serverId, workspaceId })
        if (result.status === 'already_authorized') {
          invalidateServer(serverId)
          stopConnecting(serverId)
          return
        }
        const { popup, state } = result
        // Replacement start succeeded — only now retire any prior attempt for this server (its
        // poll, safety timeout, pending entry). Kept until here so a failed reopen preserves the
        // original flow, and so a stale settle for it can't fire without the `starting` guard.
        stopPopupPoll(serverId)
        for (const [prevState, flow] of pendingFlowsRef.current) {
          if (flow.serverId === serverId) {
            window.clearTimeout(flow.timeout)
            pendingFlowsRef.current.delete(prevState)
          }
        }
        // Track this in-flight flow keyed by its `state` nonce for the BroadcastChannel gate,
        // bounded by a safety timeout in case no result ever arrives (popup abandoned, or a
        // callback failure the client can't otherwise clear).
        pendingFlowsRef.current.set(state, {
          serverId,
          timeout: window.setTimeout(() => settleFlow(state), OAUTH_FLOW_TIMEOUT_MS),
        })
        // Best-effort: clear "Connecting…" quickly when the user closes the popup without
        // finishing. popup.closed can misreport under COOP, so this only stops the spinner —
        // it never touches `pendingFlowsRef`, so it can't drop a real result.
        popupPollsRef.current.set(
          serverId,
          window.setInterval(() => {
            if (popup.closed) {
              stopPopupPoll(serverId)
              if (!startingRef.current?.has(serverId)) stopConnecting(serverId)
            }
          }, 500)
        )
      } catch (e) {
        // Preserve a still-live prior flow (it may yet complete); only clear the spinner when
        // this was the sole attempt for the server.
        if (!hadPriorFlow) stopConnecting(serverId)
        logger.error('Failed to start MCP OAuth', e)
        toast.error(toError(e).message || 'Failed to start authorization')
      } finally {
        starting.delete(serverId)
      }
    },
    [startOauth, workspaceId, settleFlow, stopConnecting, stopPopupPoll, invalidateServer]
  )

  return { connectingServers, startOauthForServer }
}
