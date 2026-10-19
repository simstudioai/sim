/** Workflow-save persistence of inline custom tools, against real PostgreSQL. */
import { db } from '@sim/db'
import { customTools, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { upsertCustomTools } from '@/lib/workflows/custom-tools/operations'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'

const owner = `custom-tools-owner-${generateId()}`
const workspaceId = generateId()

function declaration(name: string) {
  return {
    type: 'function' as const,
    function: {
      name,
      description: `Runs ${name}`,
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }
}

/** An agent block carrying inline custom tools with no `toolId`, as an imported graph does. */
function workflowStateWithInlineTools(tools: Array<{ title: string; code: string }>) {
  return {
    blocks: {
      agent: {
        type: 'agent',
        subBlocks: {
          tools: {
            value: tools.map((tool) => ({
              type: 'custom-tool',
              title: tool.title,
              schema: declaration(tool.title.toLowerCase().replace(/\W+/g, '_')),
              code: tool.code,
            })),
          },
        },
      },
    },
  }
}

async function workspaceTools() {
  return db
    .select({ title: customTools.title, code: customTools.code })
    .from(customTools)
    .where(eq(customTools.workspaceId, workspaceId))
    .orderBy(asc(customTools.title))
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: owner,
    name: 'Custom Tools',
    email: `${owner}@custom-tools.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, [
    { id: workspaceId, name: 'Custom Tools', ownerId: owner, billedAccountUserId: owner },
  ])
})

beforeEach(async () => {
  await db.delete(customTools).where(eq(customTools.workspaceId, workspaceId))
})

afterAll(async () => {
  await db.delete(customTools).where(eq(customTools.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, owner))
})

describe('extractAndPersistCustomTools', () => {
  it('re-saves a graph whose inline tool has no id and still persists the new tools beside it', async () => {
    const first = await extractAndPersistCustomTools(
      workflowStateWithInlineTools([{ title: 'Lookup order', code: 'return 1' }]),
      workspaceId,
      owner
    )
    expect(first.errors).toEqual([])

    const second = await extractAndPersistCustomTools(
      workflowStateWithInlineTools([
        { title: 'Lookup order', code: 'return 1' },
        { title: 'Refund order', code: 'return 2' },
      ]),
      workspaceId,
      owner
    )

    expect(second).toEqual({ saved: 1, errors: [] })
    expect(await workspaceTools()).toEqual([
      { title: 'Lookup order', code: 'return 1' },
      { title: 'Refund order', code: 'return 2' },
    ])
  })

  it('leaves an existing workspace tool with the same title untouched', async () => {
    await upsertCustomTools({
      tools: [{ title: 'Lookup order', schema: declaration('lookup'), code: 'return "library"' }],
      workspaceId,
      userId: owner,
    })

    const result = await extractAndPersistCustomTools(
      workflowStateWithInlineTools([{ title: 'Lookup order', code: 'return "inline"' }]),
      workspaceId,
      owner
    )

    expect(result).toEqual({ saved: 0, errors: [] })
    expect(await workspaceTools()).toEqual([{ title: 'Lookup order', code: 'return "library"' }])
  })

  it('lets concurrent saves of the same new inline tool both succeed with one row', async () => {
    const state = workflowStateWithInlineTools([{ title: 'Lookup order', code: 'return 1' }])

    const results = await Promise.all([
      extractAndPersistCustomTools(state, workspaceId, owner),
      extractAndPersistCustomTools(state, workspaceId, owner),
    ])

    expect(results.map((result) => result.errors)).toEqual([[], []])
    expect(results.map((result) => result.saved).sort()).toEqual([0, 1])
    expect(await workspaceTools()).toEqual([{ title: 'Lookup order', code: 'return 1' }])
  })
})

describe('upsertCustomTools', () => {
  it('rejects a create under a taken title and rolls back the rest of the batch', async () => {
    await upsertCustomTools({
      tools: [{ title: 'Lookup order', schema: declaration('lookup'), code: 'return 1' }],
      workspaceId,
      userId: owner,
    })

    await expect(
      upsertCustomTools({
        tools: [
          { title: 'Refund order', schema: declaration('refund'), code: 'return 2' },
          { title: 'Lookup order', schema: declaration('lookup'), code: 'return 3' },
        ],
        workspaceId,
        userId: owner,
      })
    ).rejects.toThrow('A tool with the title "Lookup order" already exists in this workspace')
    expect(await workspaceTools()).toEqual([{ title: 'Lookup order', code: 'return 1' }])
  })
})
