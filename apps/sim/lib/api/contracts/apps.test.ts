import { describe, expect, it } from 'vitest'
import {
  appProjectSchema,
  bindAppRevisionBodySchema,
  getAppProjectResponseSchema,
  listAppProjectsResponseSchema,
  publishAppWithDeployBodySchema,
  publishAppWithDeployErrorSchema,
} from '@/lib/api/contracts/apps'

const project = {
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
}

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
      project,
      publicUrl: null,
      currentRelease: null,
      releases: [],
      draftActions: [],
      latestBuild: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('enriches list items without changing the detail project shape', () => {
    expect(
      listAppProjectsResponseSchema.safeParse({
        projects: [
          {
            ...project,
            interfaceStatus: 'building',
            thumbnailUrl: '/api/apps/project-1/thumbnail',
          },
        ],
      }).success
    ).toBe(true)
    expect(listAppProjectsResponseSchema.safeParse({ projects: [project] }).success).toBe(false)
    expect(appProjectSchema.keyof().options).not.toContain('interfaceStatus')
    expect(appProjectSchema.keyof().options).not.toContain('thumbnailUrl')
  })

  it('keeps publish-with-deploy compatible while validating stable operation IDs', () => {
    expect(publishAppWithDeployBodySchema.safeParse({ expectedVersion: 2 }).success).toBe(true)
    expect(
      publishAppWithDeployBodySchema.safeParse({
        operationId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: 2,
      }).success
    ).toBe(true)
    expect(publishAppWithDeployBodySchema.safeParse({ operationId: 'retry-me' }).success).toBe(
      false
    )
  })

  it('types recoverable publish-with-deploy failures', () => {
    expect(
      publishAppWithDeployErrorSchema.safeParse({
        error: 'Still building',
        code: 'OPERATION_IN_PROGRESS',
        operationId: 'operation-1',
        stage: 'building',
        recoverable: true,
        retryAfterMs: 1000,
        recovery: {
          resumed: true,
          reusedDeployments: ['workflow-1'],
          reusedReboundRevision: true,
          reusedBuild: false,
          reusedRelease: false,
          reusedPublication: false,
        },
      }).success
    ).toBe(true)
  })
})
