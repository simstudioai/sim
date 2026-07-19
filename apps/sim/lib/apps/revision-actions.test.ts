import { describe, expect, it } from 'vitest'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import { detachRevisionAction, mergeRevisionActions } from '@/lib/apps/revision-actions'

function action(actionId: string, workflowId = `workflow-${actionId}`): AppActionManifestEntry {
  return {
    actionId,
    workflowId,
    deploymentVersionId: `version-${actionId}`,
    inputSchema: {},
    outputAllowlist: [],
    executionPolicy: 'sync',
    schemaHash: `hash-${actionId}`,
  }
}

describe('revision action updates', () => {
  it('replaces submitted actions while preserving unrelated bindings', () => {
    const replacement = action('main', 'workflow-rebound')

    expect(mergeRevisionActions([action('main'), action('secondary')], [replacement])).toEqual([
      replacement,
      action('secondary'),
    ])
  })

  it('appends newly bound actions without changing existing order', () => {
    expect(mergeRevisionActions([action('main')], [action('secondary')])).toEqual([
      action('main'),
      action('secondary'),
    ])
  })

  it('detaches only the requested action', () => {
    expect(detachRevisionAction([action('main'), action('secondary')], 'main')).toEqual({
      actions: [action('secondary')],
      detached: true,
    })
    expect(detachRevisionAction([action('secondary')], 'missing')).toEqual({
      actions: [action('secondary')],
      detached: false,
    })
  })
})
