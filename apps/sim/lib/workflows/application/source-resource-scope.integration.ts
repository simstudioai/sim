/**
 * Real PostgreSQL coverage for the check that refuses a resource id an edit writes verbatim when
 * the workflow's own workspace does not hold it live: for each kind it names (table, child
 * workflow, knowledge base), an id of another workspace and an archived one of the same workspace
 * refuse, one of the same workspace or one the enclosing apply creates first is accepted, every id
 * of a comma-separated value is checked, and a field the edit leaves alone is never checked.
 */
import { db } from '@sim/db'
import { knowledgeBase, user, userTableDefinitions, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import type { ResourceKind } from '@sim/workflow-code'
import type { BlockState } from '@sim/workflow-types/workflow'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { foreignResourceRefusals } from '@/lib/workflows/application/source-resource-scope'
import type { GraphDiff } from '@/lib/workflows/code/apply/graph-diff'
import { getBlock } from '@/blocks/registry'

const ownerId = generateId()
const ownWorkspace = generateId()
const otherWorkspace = generateId()

/** The block type and the field id that names each kind by id. */
const KINDS = {
  table: { blockType: 'table', selector: 'table-selector', kind: 'table' },
  workflow: { blockType: 'workflow', selector: 'workflow-selector', kind: 'workflow' },
  'knowledge base': {
    blockType: 'knowledge',
    selector: 'knowledge-base-selector',
    kind: 'knowledge-base',
  },
} as const

type Kind = keyof typeof KINDS

function fieldOf(kind: Kind): string {
  const { blockType, selector } = KINDS[kind]
  const field = getBlock(blockType)?.subBlocks.find((subBlock) => subBlock.type === selector)
  if (!field) throw new Error(`${blockType} has no ${selector}`)
  return field.id
}

/** A live resource of `kind` in `workspaceId`, archived when asked; returns its id. */
async function insertResource(kind: Kind, workspaceId: string, archived = false): Promise<string> {
  const id = generateId()
  const now = new Date()
  if (kind === 'table') {
    await db.insert(userTableDefinitions).values({
      id,
      workspaceId,
      name: `t_${id.slice(0, 8)}`,
      createdBy: ownerId,
      schema: { columns: [] },
      ...(archived ? { archivedAt: now } : {}),
    })
  } else if (kind === 'workflow') {
    await db.insert(workflow).values({
      id,
      workspaceId,
      userId: ownerId,
      name: `w ${id.slice(0, 8)}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      ...(archived ? { archivedAt: now } : {}),
    })
  } else {
    await db.insert(knowledgeBase).values({
      id,
      workspaceId,
      userId: ownerId,
      name: `kb ${id.slice(0, 8)}`,
      ...(archived ? { deletedAt: now } : {}),
    })
  }
  return id
}

function blockNaming(kind: Kind, value: string): BlockState {
  const field = fieldOf(kind)
  return {
    id: generateId(),
    type: KINDS[kind].blockType,
    name: `Uses ${kind}`,
    position: { x: 0, y: 0 },
    subBlocks: { [field]: { id: field, type: KINDS[kind].selector, value } },
    outputs: {},
    enabled: true,
  }
}

/** The ids `refusals` name, by the block they are on. */
async function refusedIds(
  blocks: BlockState[],
  diff: Pick<GraphDiff, 'added' | 'modified'>,
  pending: ReadonlyArray<{ kind: ResourceKind; id: string }> = []
): Promise<string[]> {
  const refusals = await foreignResourceRefusals({
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
    diff: { removed: [], edgesAdded: [], edgesRemoved: [], ...diff },
    workspaceId: ownWorkspace,
    pending,
    keyOf: () => undefined,
  })
  expect(refusals.every((refusal) => refusal.code === 'E_MAT_UNKNOWN_RESOURCE')).toBe(true)
  return refusals.map((refusal) => /"([^"]+)"/.exec(refusal.message)?.[1] ?? '')
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Resource scope fixture',
    email: `${ownerId}@resource-scope.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  for (const id of [ownWorkspace, otherWorkspace]) {
    await insertWorkspaceFixture(db, {
      id,
      name: 'Resource scope',
      ownerId,
      billedAccountUserId: ownerId,
    })
  }
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, [ownWorkspace, otherWorkspace]))
  await db.delete(user).where(eq(user.id, ownerId))
})

describe('foreignResourceRefusals', () => {
  it.each(Object.keys(KINDS) as Kind[])(
    'refuses a %s of another workspace or an archived one, and accepts its own or a pending one',
    async (kind) => {
      const own = await insertResource(kind, ownWorkspace)
      const foreign = await insertResource(kind, otherWorkspace)
      const archived = await insertResource(kind, ownWorkspace, true)
      const pending = generateId()
      const blocks = [own, foreign, archived, pending].map((id) => blockNaming(kind, id))

      const refused = await refusedIds(
        blocks,
        { added: blocks.map((block) => block.id), modified: [] },
        [{ kind: KINDS[kind].kind, id: pending }]
      )

      expect(refused.sort()).toEqual([foreign, archived].sort())
    }
  )

  it('counts a pending id as held only in a field of its own kind', async () => {
    const adopted = await insertResource('knowledge base', ownWorkspace)
    const block = blockNaming('table', adopted)

    expect(
      await refusedIds([block], { added: [block.id], modified: [] }, [
        { kind: 'knowledge-base', id: adopted },
      ])
    ).toEqual([adopted])
  })

  it('checks every id of a comma-separated value', async () => {
    const own = await insertResource('table', ownWorkspace)
    const foreign = await insertResource('table', otherWorkspace)
    const block = blockNaming('table', `${own}, ${foreign}`)

    expect(await refusedIds([block], { added: [block.id], modified: [] })).toEqual([foreign])
  })

  it('never checks a field the edit leaves alone, so a stored dangling id refuses nothing', async () => {
    const foreign = await insertResource('table', otherWorkspace)
    const block = blockNaming('table', foreign)
    const modified = {
      id: block.id,
      subBlocks: ['code'],
      attributes: ['name'],
      typeChanged: false,
      parentChanged: false,
      lockedChanged: false,
      enabledChanged: false,
    }

    expect(await refusedIds([block], { added: [], modified: [modified] })).toEqual([])
    expect(
      await refusedIds([block], {
        added: [],
        modified: [{ ...modified, subBlocks: [fieldOf('table')] }],
      })
    ).toEqual([foreign])
  })
})
