/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getCreateWorkspaceCopy } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'

describe('getCreateWorkspaceCopy', () => {
  it('labels viewer-account personal creation explicitly', () => {
    expect(getCreateWorkspaceCopy({ type: 'personal' })).toEqual({
      title: 'Create personal workspace',
      description: 'This workspace will belong to your personal account.',
    })
  })

  it('names the viewer active organization as the creation target', () => {
    expect(
      getCreateWorkspaceCopy({
        type: 'organization',
        organizationName: 'Viewer Org A',
      })
    ).toEqual({
      title: 'Create workspace in Viewer Org A',
      description: 'This workspace will belong to Viewer Org A and use its workspace policy.',
    })
  })
})
