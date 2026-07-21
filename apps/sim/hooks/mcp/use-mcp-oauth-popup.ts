'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  // Per-server count of live authorization attempts; a row shows "Connecting…" / "Reopen
  // authorization" while its count > 0. Reference counting (not a boolean set) keeps the label
  // deterministic across concurrent attempts: a reopen increments before the superseded flow
  // decrements, so the count never dips to 0 mid-reopen (no flicker), and every attempt clears
  // exactly once (never stuck).
  const [connectingCounts, setConnectingCounts] = useState<Map<string, number>>(() => new Map())
  // OAuth `state` nonce -> { serverId, safety timeout }. `state` keys the BroadcastChannel
  // correlation: the callback echoes it on every result (even failures that resolve no serverId),
  // so the tab that started this exact flow matches it while other same-origin tabs — and
  // unrelated flows in this tab — ignore the broadcast.
  const pendingFlowsRef = useRef<Map<string, { serverId: string; timeout: number }>>(new Map())
  // serverIds with an in-flight `/oauth/start` request — guards a fast double-click from opening
  // two popups. Cleared once the request settles, so a later click (to reopen an abandoned
  // popup) still starts a fresh flow.
  const startingRef = useRef<Set<string> | null>(null)

  const incConnecting = useCallback((serverId: string) => {
    setConnectingCounts((prev) => {
      const next = new Map(prev)
      next.set(serverId, (next.get(serverId) ?? 0) + 1)
      return next
    })
  }, [])

  const decConnecting = useCallback((serverId: string) => {
    setConnectingCounts((prev) => {
      const current = prev.get(serverId)
      if (current === undefined) return prev
      const next = new Map(prev)
      if (current <= 1) next.delete(serverId)
      else next.set(serverId, current - 1)
      return next
    })
  }, [])

  const invalidateServer = useCallback(
    (serverId: string) => {
      queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.serverToolsList(workspaceId, serverId) })
      queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(workspaceId) })
    },
    [queryClient, workspaceId]
  )

  /** End one flow by its `state` nonce, decrementing its server's connecting count exactly once. */
  const settleFlow = useCallback(
    (state: string) => {
      const flow = pendingFlowsRef.current.get(state)
      if (!flow) return
      window.clearTimeout(flow.timeout)
      pendingFlowsRef.current.delete(state)
      decConnecting(flow.serverId)
    },
    [decConnecting]
  )

  /** Retire every prior flow for a server, superseded by a fresh attempt (each decrements once). */
  const retireFlows = useCallback(
    (serverId: string) => {
      const states: string[] = []
      for (const [state, flow] of pendingFlowsRef.current) {
        if (flow.serverId === serverId) states.push(state)
      }
      for (const state of states) settleFlow(state)
    },
    [settleFlow]
  )

  useEffect(() => {
    const pending = pendingFlowsRef.current
    return () => {
      for (const { timeout } of pending.values()) window.clearTimeout(timeout)
      pending.clear()
    }
  }, [])

  useEffect(() => {
    // The callback signals over a same-origin BroadcastChannel (see the OAuth callback route): a
    // provider whose authorize page sets COOP `same-origin` severs `window.opener`, so a popup
    // `postMessage` can be lost and leave the row stuck on "Connecting…". A BroadcastChannel is
    // origin-scoped, so it needs no origin check.
    const channel = new BroadcastChannel('mcp-oauth')
    channel.onmessage = (event) => {
      const data = event.data as Partial<McpOauthCallbackMessage> | null
      if (data?.type !== 'mcp-oauth') return
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
      incConnecting(serverId) // this attempt begins
      try {
        const result = await startOauth({ serverId, workspaceId })
        // The replacement start succeeded (already-authorized, or a fresh popup opened), so retire
        // any prior attempt for this server now — its result is moot and the server-side `state`
        // it depended on has been overwritten. A *failed* start (below) leaves prior flows intact.
        retireFlows(serverId)
        if (result.status === 'already_authorized') {
          invalidateServer(serverId)
          decConnecting(serverId) // this attempt ends
          return
        }
        // Track the in-flight flow by its `state` nonce for the BroadcastChannel gate, bounded by
        // a safety timeout in case no result ever arrives (popup abandoned, or a callback the
        // client can't otherwise observe under COOP).
        const { state } = result
        pendingFlowsRef.current.set(state, {
          serverId,
          timeout: window.setTimeout(() => settleFlow(state), OAUTH_FLOW_TIMEOUT_MS),
        })
      } catch (e) {
        decConnecting(serverId) // this attempt ends; any prior flow keeps its own count
        logger.error('Failed to start MCP OAuth', e)
        toast.error(toError(e).message || 'Failed to start authorization')
      } finally {
        starting.delete(serverId)
      }
    },
    [
      startOauth,
      workspaceId,
      settleFlow,
      retireFlows,
      incConnecting,
      decConnecting,
      invalidateServer,
    ]
  )

  const connectingServers = useMemo(() => {
    const set = new Set<string>()
    for (const [serverId, count] of connectingCounts) {
      if (count > 0) set.add(serverId)
    }
    return set
  }, [connectingCounts])

  return { connectingServers, startOauthForServer }
}
