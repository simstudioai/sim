/**
 * Real PostgreSQL coverage for the `workflow-code` preview gate on the source operations. The
 * gate answers only after authorization, so with the flag off a caller who cannot reach the
 * workspace sees the same concealed not-found for a real workflow or workspace as for a made-up
 * one (no existence or rollout oracle), and a member who can reach it is told the feature is off
 * with `FEATURE_NOT_ENABLED`, on `authorize` (what a `HEAD` runs) as on `execute`.
 */

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
import { readSourceCatalog } from '@/lib/workflows/application/read-source-catalog'
import { readSourceResources } from '@/lib/workflows/application/read-source-resources'
import {
  readWorkflowSource,
  readWorkflowSources,
} from '@/lib/workflows/application/read-workflow-source'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'

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
  it('conceals a real workflow from an outsider exactly as a made-up one', async () => {
    const real = await answer(
      readWorkflowSource.execute({ principal: outsider, input: { workflowId } })
    )
    const fake = await answer(
      readWorkflowSource.execute({ principal: outsider, input: { workflowId: generateId() } })
    )
    expect(real).toEqual(NOT_FOUND)
    expect(fake).toEqual(NOT_FOUND)
  })

  it('conceals a real workspace from an outsider exactly as a made-up one', async () => {
    for (const useCase of [readSourceResources, readSourceCatalog, readWorkspaceSource]) {
      const real = await answer(useCase.execute({ principal: outsider, input: { workspaceId } }))
      const fake = await answer(
        useCase.execute({ principal: outsider, input: { workspaceId: generateId() } })
      )
      expect(real).toEqual(NOT_FOUND)
      expect(fake).toEqual(NOT_FOUND)
    }
    const real = await answer(
      readWorkflowSources.execute({
        principal: outsider,
        input: { workspaceId, workflowIds: [workflowId] },
      })
    )
    expect(real).toEqual(NOT_FOUND)
  })

  it('tells a member the feature is off with FEATURE_NOT_ENABLED on authorize and execute', async () => {
    const workflowInput = { principal: member, input: { workflowId } }
    const workspaceInput = { principal: member, input: { workspaceId } }
    expect(await answer(readWorkflowSource.execute(workflowInput))).toEqual(FEATURE_OFF)
    expect(await answer(readWorkflowSource.authorize(workflowInput))).toEqual(FEATURE_OFF)
    for (const useCase of [readSourceResources, readSourceCatalog, readWorkspaceSource]) {
      expect(await answer(useCase.execute(workspaceInput))).toEqual(FEATURE_OFF)
      expect(await answer(useCase.authorize(workspaceInput))).toEqual(FEATURE_OFF)
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
