import { describe, expect, it } from 'vitest'
import { DRAFT_DEPLOYMENT_VERSION_SENTINEL, isDraftDeploymentVersionId } from '@/lib/apps/draft-binding'
import { MISSING_VERSION_PUBLISH_ERROR } from '@/lib/apps/publish'

/**
 * Document the publish gate: draft sentinels are rejected before version lookup.
 * validateReleaseActionsForActivation applies this in production; this keeps the
 * contract visible without standing up a full DB mock.
 */
describe('draft binding publish gate', () => {
  it('classifies sentinel actions as draft-bound (non-publishable)', () => {
    const actions = [
      { workflowId: 'wf-1', deploymentVersionId: DRAFT_DEPLOYMENT_VERSION_SENTINEL },
      { workflowId: 'wf-2', deploymentVersionId: 'dv-real' },
    ]
    const draftOnly = actions.filter((a) => isDraftDeploymentVersionId(a.deploymentVersionId))
    expect(draftOnly).toHaveLength(1)
    expect(MISSING_VERSION_PUBLISH_ERROR).toMatch(/rebind/i)
  })
})
