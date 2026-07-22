import type { MutationStatus } from '@tanstack/react-query'
import type { McpServer, RefreshMcpServerResult } from '@/lib/api/contracts/mcp'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'

interface RefreshActionStateInput {
  mutationStatus: MutationStatus
  connectionStatus?: RefreshMcpServerResult['status']
  authType?: McpServer['authType']
  error?: RefreshMcpServerResult['error']
  workflowsUpdated?: number
}

type RefreshActionState = Pick<SettingsAction, 'text' | 'textTone' | 'disabled'>

export function getRefreshActionState({
  mutationStatus,
  connectionStatus,
  authType,
  error,
  workflowsUpdated,
}: RefreshActionStateInput): RefreshActionState {
  if (mutationStatus === 'pending') {
    return { text: 'Refreshing...', textTone: undefined, disabled: true }
  }

  if (
    mutationStatus === 'success' &&
    connectionStatus === 'disconnected' &&
    authType === 'oauth' &&
    !error?.trim()
  ) {
    // The detail view's Status field carries the "OAuth authorization required"
    // explanation; the header chip stays a short action-shaped result.
    return { text: 'Failed', textTone: 'error', disabled: false }
  }

  if (
    mutationStatus === 'error' ||
    (mutationStatus === 'success' && connectionStatus !== 'connected')
  ) {
    return { text: 'Failed', textTone: 'error', disabled: false }
  }

  if (mutationStatus === 'success') {
    const text = workflowsUpdated
      ? `Synced (${workflowsUpdated} workflow${workflowsUpdated === 1 ? '' : 's'})`
      : 'Refreshed'
    return { text, textTone: undefined, disabled: true }
  }

  return { text: 'Refresh tools', textTone: undefined, disabled: false }
}
