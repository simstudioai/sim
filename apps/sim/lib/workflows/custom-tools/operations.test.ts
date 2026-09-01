/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertCustomTools } from '@/lib/workflows/custom-tools/operations'

const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'

const storableSchema = {
  type: 'function',
  function: {
    name: 'lookup_order',
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
  },
}

describe('upsertCustomTools schema invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a declaration missing the function discriminator before opening a transaction', async () => {
    await expect(
      upsertCustomTools({
        tools: [
          { title: 'No discriminator', schema: { function: storableSchema.function }, code: '' },
        ],
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('refuses the whole batch when any declaration is unstorable', async () => {
    await expect(
      upsertCustomTools({
        tools: [
          { title: 'Good', schema: storableSchema, code: '' },
          { title: 'Bad', schema: { ...storableSchema, type: 'object' }, code: '' },
        ],
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(db.transaction).not.toHaveBeenCalled()
  })

  /**
   * The stored declaration is what the model is handed. A name outside the
   * `[a-zA-Z0-9_-]{1,64}` charset every provider enforces, or a `parameters`
   * type that is not an object, used to be stored verbatim because the shared
   * read shape only checks that the name is a non-empty string.
   */
  it.each([
    ['a function name no provider accepts', { ...storableSchema.function, name: 'has spaces!' }],
    [
      'a parameters type that is not an object',
      {
        ...storableSchema.function,
        parameters: { type: 'banana', properties: {} },
      },
    ],
  ])('refuses %s', async (_label, functionDeclaration) => {
    await expect(
      upsertCustomTools({
        tools: [
          { title: 'Bad', schema: { type: 'function', function: functionDeclaration }, code: '' },
        ],
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('opens the transaction for a storable declaration', async () => {
    await upsertCustomTools({
      tools: [{ title: 'Good', schema: storableSchema, code: '' }],
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    })

    expect(db.transaction).toHaveBeenCalled()
  })
})
