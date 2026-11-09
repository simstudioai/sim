import type { ComponentProps } from 'react'
import type { McpServerFormModal } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form'
import type { McpServer, RefreshMcpServerResult } from '@/platform/lib/data/mcp'

/** `streamable-http` → `Streamable-HTTP`. */
export function formatTransportLabel(transport: string): string {
  return transport
    .split('-')
    .map((word) =>
      ['http', 'sse', 'stdio'].includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('-')
}

/** A server's connection problem, or its tool count and names while it is connected. */
export function getServerToolsLabel(
  tools: readonly { name: string }[],
  connectionStatus?: McpServer['connectionStatus'],
  lastError?: McpServer['lastError'],
  authType?: McpServer['authType']
): string {
  if (connectionStatus === 'error') {
    return lastError?.trim() || 'Unable to connect'
  }
  if (connectionStatus === 'disconnected') {
    return (
      lastError?.trim() || (authType === 'oauth' ? 'OAuth authorization required' : 'Not connected')
    )
  }
  const count = tools.length
  const names = count > 0 ? `: ${tools.map((tool) => tool.name).join(', ')}` : ''
  return `${count} tool${count !== 1 ? 's' : ''}${names}`
}

interface RefreshActionStateInput {
  mutationStatus: 'idle' | 'pending' | 'error' | 'success'
  connectionStatus?: RefreshMcpServerResult['status']
  workflowsUpdated?: number
}

/** The refresh action names its last outcome until the outcome expires. */
export function getRefreshActionState({
  mutationStatus,
  connectionStatus,
  workflowsUpdated,
}: RefreshActionStateInput): { label: string; disabled: boolean } {
  if (mutationStatus === 'pending') return { label: 'Refreshing…', disabled: true }
  if (
    mutationStatus === 'error' ||
    (mutationStatus === 'success' && connectionStatus !== 'connected')
  ) {
    return { label: 'Failed', disabled: false }
  }
  if (mutationStatus === 'success') {
    return {
      label: workflowsUpdated
        ? `Synced (${workflowsUpdated} workflow${workflowsUpdated === 1 ? '' : 's'})`
        : 'Refreshed',
      disabled: true,
    }
  }
  return { label: 'Refresh tools', disabled: false }
}

/** The edit form's starting values, with the trailing empty header row the form keeps. */
export function buildEditInitialData(
  server: McpServer
): ComponentProps<typeof McpServerFormModal>['initialData'] {
  const headers = server.headers
    ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
    : []
  const last = headers.at(-1)
  if (!last || last.key !== '' || last.value !== '') headers.push({ key: '', value: '' })
  return {
    name: server.name || '',
    transport: server.transport,
    url: server.url || '',
    timeout: 30000,
    headers,
    oauthClientId: server.oauthClientId || undefined,
    hasOauthClientSecret: server.hasOauthClientSecret === true,
  }
}
