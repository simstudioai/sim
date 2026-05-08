/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  releaseDeployAction,
  tryAcquireDeployAction,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/deploy-action-lock'

describe('deploy action lock', () => {
  it('serializes deploy actions per workflow', () => {
    try {
      expect(tryAcquireDeployAction('workflow-a')).toBe(true)
      expect(tryAcquireDeployAction('workflow-a')).toBe(false)
      expect(tryAcquireDeployAction('workflow-b')).toBe(true)

      releaseDeployAction('workflow-a')
      expect(tryAcquireDeployAction('workflow-a')).toBe(true)
    } finally {
      releaseDeployAction('workflow-a')
      releaseDeployAction('workflow-b')
    }
  })
})
