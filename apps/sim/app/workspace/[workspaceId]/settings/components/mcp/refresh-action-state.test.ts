import { describe, expect, it } from 'vitest'
import { getRefreshActionState } from '@/app/workspace/[workspaceId]/settings/components/mcp/refresh-action-state'

describe('getRefreshActionState', () => {
  it.each(['error', 'disconnected'] as const)(
    'shows a retryable red-text Failed state when refresh returns %s',
    (status) => {
      expect(
        getRefreshActionState({
          mutationStatus: 'success',
          connectionStatus: status,
          workflowsUpdated: 0,
        })
      ).toEqual({
        text: 'Failed',
        textTone: 'error',
        disabled: false,
      })
    }
  )

  it('shows Failed when the refresh request itself rejects', () => {
    expect(
      getRefreshActionState({
        mutationStatus: 'error',
      })
    ).toEqual({
      text: 'Failed',
      textTone: 'error',
      disabled: false,
    })
  })

  it('preserves successful refresh feedback', () => {
    expect(
      getRefreshActionState({
        mutationStatus: 'success',
        connectionStatus: 'connected',
        workflowsUpdated: 2,
      })
    ).toEqual({
      text: 'Synced (2 workflows)',
      textTone: undefined,
      disabled: true,
    })
  })
})
