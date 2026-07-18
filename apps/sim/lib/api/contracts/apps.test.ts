import { describe, expect, it } from 'vitest'
import { bindAppRevisionBodySchema, getAppProjectResponseSchema } from '@/lib/api/contracts/apps'

describe('Apps contracts', () => {
  it('rejects duplicate action ids and output keys', () => {
    const base = {
      workflowId: 'workflow-1',
      deploymentVersionId: 'version-1',
      executionPolicy: 'sync' as const,
      outputAllowlist: [
        { key: 'content', blockId: 'block-1', path: 'content' },
        { key: 'content', blockId: 'block-2', path: 'content' },
      ],
    }
    const parsed = bindAppRevisionBodySchema.safeParse({
      actions: [
        { ...base, actionId: 'main' },
        { ...base, actionId: 'main', outputAllowlist: [] },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts the typed app project detail response', () => {
    const parsed = getAppProjectResponseSchema.safeParse({
      project: {
        id: 'project-1',
        workspaceId: 'workspace-1',
        name: 'App',
        publicId: 'public-1',
        slug: 'app',
        draftRevisionId: 'revision-1',
        publishedReleaseId: null,
        createdFromChatId: null,
        lastBuilderChatId: null,
        createdBy: 'user-1',
        version: 0,
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      publicUrl: null,
      currentRelease: null,
      releases: [],
      draftActions: [],
      latestBuild: null,
    })
    expect(parsed.success).toBe(true)
  })
})
