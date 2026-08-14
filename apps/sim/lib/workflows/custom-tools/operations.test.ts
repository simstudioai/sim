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

  it('opens the transaction for a storable declaration', async () => {
    await upsertCustomTools({
      tools: [{ title: 'Good', schema: storableSchema, code: '' }],
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    })

    expect(db.transaction).toHaveBeenCalled()
  })
})
