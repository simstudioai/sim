'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
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

export function useMcpOauthPopup({ workspaceId }: UseMcpOauthPopupProps) {
  const queryClient = useQueryClient()
  const { mutateAsync: startOauth } = useStartMcpOauth()

  const [connectingServers, setConnectingServers] = useState<Set<string>>(() => new Set())
  const popupIntervalsRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const intervals = popupIntervalsRef.current
    return () => {
      for (const id of intervals.values()) window.clearInterval(id)
      intervals.clear()
    }
  }, [])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as Partial<McpOauthCallbackMessage> | null
      if (data?.type !== 'mcp-oauth') return
      if (data.serverId) {
        const serverId = data.serverId
        const interval = popupIntervalsRef.current.get(serverId)
        if (interval !== undefined) {
          window.clearInterval(interval)
          popupIntervalsRef.current.delete(serverId)
        }
        setConnectingServers((prev) => {
          if (!prev.has(serverId)) return prev
          const next = new Set(prev)
          next.delete(serverId)
          return next
        })
      } else if (!data.ok) {
        // Early callback failures (missing params, invalid state) post back
        // without a serverId, so we can't target a specific row — clear all
        // in-flight popups instead of leaving the UI stuck on "Connecting…".
        for (const id of popupIntervalsRef.current.values()) window.clearInterval(id)
        popupIntervalsRef.current.clear()
        setConnectingServers((prev) => (prev.size === 0 ? prev : new Set()))
      }
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) })
        if (data.serverId) {
          queryClient.invalidateQueries({
            queryKey: mcpKeys.serverToolsList(workspaceId, data.serverId),
          })
        } else {
          queryClient.invalidateQueries({
            queryKey: mcpKeys.serverToolsWorkspace(workspaceId),
          })
        }
        queryClient.invalidateQueries({ queryKey: mcpKeys.storedToolsList(workspaceId) })
        toast.success('Server authorized')
      } else {
        toast.error(reasonToMessage(data.reason))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [queryClient, workspaceId])

  const startOauthForServer = useCallback(
    async (serverId: string) => {
      setConnectingServers((prev) => new Set(prev).add(serverId))
      const clear = () => {
        const existing = popupIntervalsRef.current.get(serverId)
        if (existing !== undefined) {
          window.clearInterval(existing)
          popupIntervalsRef.current.delete(serverId)
        }
        setConnectingServers((prev) => {
          const next = new Set(prev)
          next.delete(serverId)
          return next
        })
      }
      try {
        const result = await startOauth({ serverId, workspaceId })
        if (result.status === 'already_authorized') {
          clear()
          return
        }
        const { popup } = result
        const existing = popupIntervalsRef.current.get(serverId)
        if (existing !== undefined) window.clearInterval(existing)
        const interval = window.setInterval(() => {
          if (popup.closed) clear()
        }, 500)
        popupIntervalsRef.current.set(serverId, interval)
      } catch (e) {
        clear()
        logger.error('Failed to start MCP OAuth', e)
        toast.error(toError(e).message || 'Failed to start authorization')
      }
    },
    [startOauth, workspaceId]
  )

  return { connectingServers, startOauthForServer }
}
