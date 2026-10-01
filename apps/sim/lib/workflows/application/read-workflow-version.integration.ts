import { db } from '@sim/db'
import { permissions, user, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareWorkflowVersions } from '@/lib/workflows/application/compare-workflow-versions'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const sessionPrincipal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const keyPrincipal = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })

function snapshot(
  field: 'knowledgeBaseId' | 'knowledgeBaseSelector',
  value: string
): WorkflowState {
  return {
    blocks: {
      knowledge: {
        id: 'knowledge',
        type: 'knowledge',
        name: 'Knowledge',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          [field]: { id: field, type: 'knowledge-base-selector', value },
        },
      },
      convex: {
        id: 'convex',
        type: 'convex',
        name: 'Convex',
        enabled: true,
        position: { x: 300, y: 0 },
        outputs: {},
        subBlocks: {
          deployKey: { id: 'deployKey', type: 'short-input', value: `private-${value}` },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
    lastSaved: 0,
  }
}

const snapshots = [
  snapshot('knowledgeBaseId', 'kb-original'),
  snapshot('knowledgeBaseSelector', 'kb-original'),
  snapshot('knowledgeBaseSelector', 'kb-replacement'),
]

const comparisonInput = (version: number) => ({
  workflowId,
  version,
  includeCredentialValues: true,
  representation: 'comparison' as const,
})

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, outsiderId].map((id) => ({
      id,
      name: 'Version read fixture',
      email: `${id}@version-read.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'Version read fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Version read fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(workflowDeploymentVersion)
    .values(
      snapshots.map((state, index) => ({ id: generateId(), workflowId, version: index + 1, state }))
    )
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, [ownerId, outsiderId]))
  await db.$client.end()
})

describe('deployment version representations through the authorized application boundary', () => {
  it('compares migrated previews consistently with the API while retaining archived snapshots', async () => {
    const base = await readWorkflowVersion.execute({
      principal: sessionPrincipal,
      input: comparisonInput(1),
    })
    const equivalent = await readWorkflowVersion.execute({
      principal: sessionPrincipal,
      input: comparisonInput(2),
    })
    const target = await readWorkflowVersion.execute({
      principal: sessionPrincipal,
      input: comparisonInput(3),
    })
    const compare = (version: number) =>
      compareWorkflowVersions.execute({
        principal: keyPrincipal,
        input: { workflowId, base: 1, target: version },
      })

    expect(
      generateWorkflowDiffSummary(equivalent.version.state, base.version.state).hasChanges
    ).toBe(false)
    expect((await compare(2)).diff.hasChanges).toBe(false)
    const previewDiff = generateWorkflowDiffSummary(target.version.state, base.version.state)
    expect(previewDiff.modifiedBlocks.find((block) => block.id === 'knowledge')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'knowledgeBaseSelector',
        oldValue: 'kb-original',
        newValue: 'kb-replacement',
      },
    ])
    expect(previewDiff.modifiedBlocks.find((block) => block.id === 'convex')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'deployKey',
        oldValue: 'private-kb-original',
        newValue: 'private-kb-replacement',
      },
    ])
    const publicDiff = (await compare(3)).diff
    expect(publicDiff.modifiedBlocks.find((block) => block.id === 'knowledge')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'knowledgeBaseSelector',
        oldValue: { kind: 'value', value: 'kb-original' },
        newValue: { kind: 'value', value: 'kb-replacement' },
      },
    ])
    expect(publicDiff.modifiedBlocks.find((block) => block.id === 'convex')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'deployKey',
        oldValue: { kind: 'redacted' },
        newValue: { kind: 'redacted' },
      },
    ])

    const pinned = await readWorkflowVersion.execute({
      principal: keyPrincipal,
      input: { workflowId, version: 1 },
    })
    expect(pinned.version.state.blocks.knowledge.subBlocks).toHaveProperty('knowledgeBaseId')
    expect(pinned.version.state.blocks.knowledge.subBlocks).not.toHaveProperty(
      'knowledgeBaseSelector'
    )
    expect(pinned.version.state.blocks.convex.subBlocks.deployKey.value).toBeNull()
    const stored = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
      .orderBy(workflowDeploymentVersion.version)
    expect(stored.map((row) => row.state)).toEqual(snapshots)
  })

  it('rejects an unauthorized session before returning an unredacted comparison preview', async () => {
    await expect(
      readWorkflowVersion.execute({
        principal: createSessionPrincipal({ userId: outsiderId, sessionId: generateId() }),
        input: comparisonInput(1),
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
