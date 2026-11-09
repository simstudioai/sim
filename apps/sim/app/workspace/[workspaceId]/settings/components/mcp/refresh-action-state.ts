import type { MutationStatus } from '@tanstack/react-query'
import type { SettingsAction } from '@/components/settings/primitives/settings-header/settings-header'
import type { RefreshMcpServerResult } from '@/lib/api/contracts/mcp'

interface RefreshActionStateInput {
  mutationStatus: MutationStatus
  connectionStatus?: RefreshMcpServerResult['status']
  workflowsUpdated?: number
}

type RefreshActionState = Pick<SettingsAction, 'text' | 'textTone' | 'disabled'>

export function getRefreshActionState({
  mutationStatus,
  connectionStatus,
  workflowsUpdated,
}: RefreshActionStateInput): RefreshActionState {
  if (mutationStatus === 'pending') {
    return { text: 'Refreshing...', textTone: undefined, disabled: true }
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
