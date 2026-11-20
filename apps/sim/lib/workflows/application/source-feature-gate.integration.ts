/**
 * Real PostgreSQL coverage for the `workflow-code` preview gate on the source operations. The
 * gate answers only after authorization, so with the flag off a caller who cannot reach the
 * workspace sees the same concealed not-found for a real workflow or workspace as for a made-up
 * one (no existence or rollout oracle), and a member who can reach it is told the feature is off
 * with `FEATURE_NOT_ENABLED`, on `authorize` (what a `HEAD` runs) as on `execute`. Every source use
 * case is checked, the plans, applies, create and blob staging included, so an operation that
 * loses its `feature` declaration fails here.
 */

import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { permissions, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { concealCrossTenantResourceError } from '@/lib/api/server/routes/resource-concealment'
import { forbiddenErrorDetails } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  applyWorkflowSource,
  createWorkflowFromSource,
  planWorkflowSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { readSourceCatalog } from '@/lib/workflows/application/read-source-catalog'
import { readSourceResources } from '@/lib/workflows/application/read-source-resources'
import {
  readWorkflowSource,
  readWorkflowSources,
} from '@/lib/workflows/application/read-workflow-source'
import {
  applyWorkspaceSource,
  planWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'
import {
  admitSourceBlobStage,
  findMissingSourceBlobs,
  stageSourceBlobs,
} from '@/lib/workspace-source/application/stage-blobs'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const member = createSessionPrincipal({ userId: ownerId })
const outsider = createSessionPrincipal({ userId: outsiderId })

/** What a v2 route answers for a failure: the concealed orchestration code and any 403 cause. */
async function answer(run: Promise<unknown>) {
  try {
    await run
  } catch (error) {
    const shown = concealCrossTenantResourceError(error, 'Not found')
    if (!(shown instanceof OrchestrationError)) throw error
    return { code: shown.code, details: forbiddenErrorDetails(shown) }
  }
  throw new Error('Expected the operation to be refused')
}

/** A source use case, run on the workflow (or workspace) with id `id`. */
interface GatedUseCase {
  name: string
  execute(principal: Principal, id: string): Promise<unknown>
  authorize(principal: Principal, id: string): Promise<unknown>
}

/** A use case whose input names the workflow it acts on. */
function onWorkflow<I>(
  name: string,
  useCase: {
    execute(args: { principal: Principal; input: I }): Promise<unknown>
    authorize(args: { principal: Principal; input: I }): Promise<unknown>
  },
  input: (workflowId: string) => I
): GatedUseCase {
  return {
    name,
    execute: (principal, id) => useCase.execute({ principal, input: input(id) }),
    authorize: (principal, id) => useCase.authorize({ principal, input: input(id) }),
  }
}

const onWorkspace = onWorkflow

const SUBMISSION = {
  files: {},
  lock: { version: 1 as const, blocks: {}, variables: {} },
}

/** Every source use case that acts on one workflow. */
const WORKFLOW_USE_CASES: GatedUseCase[] = [
  onWorkflow('readWorkflowSource', readWorkflowSource, (id) => ({ workflowId: id })),
  ...[
    ['applyWorkflowSource', applyWorkflowSource],
    ['planWorkflowSource', planWorkflowSource],
  ].map(([name, useCase]) =>
    onWorkflow(String(name), useCase as typeof applyWorkflowSource, (id) => ({
      workflowId: id,
      ...SUBMISSION,
      base: {
        version: 1 as const,
        workflowId: id,
        workspaceId,
        fingerprint: 'sf1:x',
        catalogHash: 'h',
      },
    }))
  ),
]

/** Every source use case that acts on a workspace. */
const WORKSPACE_USE_CASES: GatedUseCase[] = [
  onWorkspace('readSourceResources', readSourceResources, (id) => ({ workspaceId: id })),
  onWorkspace('readSourceCatalog', readSourceCatalog, (id) => ({ workspaceId: id })),
  onWorkspace('readWorkspaceSource', readWorkspaceSource, (id) => ({ workspaceId: id })),
  onWorkspace('readWorkflowSources', readWorkflowSources, (id) => ({
    workspaceId: id,
    workflowIds: [workflowId],
  })),
  onWorkspace('createWorkflowFromSource', createWorkflowFromSource, (id) => ({
    workspaceId: id,
    files: {},
  })),
  onWorkspace('planWorkspaceSource', planWorkspaceSource, (id) => ({
    workspaceId: id,
    files: {},
    kinds: [],
  })),
  onWorkspace('applyWorkspaceSource', applyWorkspaceSource, (id) => ({
    workspaceId: id,
    files: {},
    kinds: [],
  })),
  onWorkspace('admitSourceBlobStage', admitSourceBlobStage, (id) => ({ workspaceId: id })),
  onWorkspace('stageSourceBlobs', stageSourceBlobs, (id) => ({ workspaceId: id, blobs: [] })),
  onWorkspace('findMissingSourceBlobs', findMissingSourceBlobs, (id) => ({
    workspaceId: id,
    blobs: [],
  })),
]

const NOT_FOUND = { code: 'not_found', details: undefined }
const FEATURE_OFF = { code: 'forbidden', details: { code: 'FEATURE_NOT_ENABLED' } }

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, outsiderId].map((id) => ({
      id,
      name: 'Source feature gate fixture',
      email: `${id}@source-feature-gate.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Source feature gate',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    entityType: 'workspace',
    entityId: workspaceId,
    userId: ownerId,
    permissionType: 'admin',
  })
  await db.insert(workflow).values({
    id: workflowId,
    workspaceId,
    userId: ownerId,
    name: 'Gated',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
})

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId]))
  await db.delete(user).where(inArray(user.id, [ownerId, outsiderId]))
})

describe('workflow-code gate with the flag off', () => {
  it('conceals a real workflow or workspace from an outsider exactly as a made-up one', async () => {
    const cases = [
      ...WORKFLOW_USE_CASES.map((useCase) => ({ useCase, id: workflowId })),
      ...WORKSPACE_USE_CASES.map((useCase) => ({ useCase, id: workspaceId })),
    ]
    for (const { useCase, id } of cases) {
      const real = await answer(useCase.execute(outsider, id))
      const fake = await answer(useCase.execute(outsider, generateId()))
      expect({ name: useCase.name, real, fake }).toEqual({
        name: useCase.name,
        real: NOT_FOUND,
        fake: NOT_FOUND,
      })
    }
  })

  it('tells a member the feature is off with FEATURE_NOT_ENABLED on authorize and execute', async () => {
    const cases = [
      ...WORKFLOW_USE_CASES.map((useCase) => ({ useCase, id: workflowId })),
      ...WORKSPACE_USE_CASES.map((useCase) => ({ useCase, id: workspaceId })),
    ]
    for (const { useCase, id } of cases) {
      expect({
        name: useCase.name,
        execute: await answer(useCase.execute(member, id)),
        authorize: await answer(useCase.authorize(member, id)),
      }).toEqual({ name: useCase.name, execute: FEATURE_OFF, authorize: FEATURE_OFF })
    }
  })

  it('serves a member once the flag is on for the workspace', async () => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag: string, scope?: unknown) =>
        flag === 'workflow-code' &&
        typeof scope === 'object' &&
        scope !== null &&
        'workspaceId' in scope &&
        scope.workspaceId === workspaceId
    )
    const source = await readWorkflowSource.execute({ principal: member, input: { workflowId } })
    expect(source.workflowId).toBe(workflowId)
  })
})
