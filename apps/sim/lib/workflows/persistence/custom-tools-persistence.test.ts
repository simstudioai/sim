/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpsertCustomTools } = vi.hoisted(() => ({
  mockUpsertCustomTools: vi.fn(),
}))

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  upsertCustomTools: mockUpsertCustomTools,
}))

import { persistCustomToolsToDatabase } from '@/lib/workflows/persistence/custom-tools-persistence'

const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'

const storableSchema = {
  type: 'function' as const,
  function: {
    name: 'lookup_order',
    description: 'Looks up an order',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
}

function customTool(overrides: Record<string, unknown> = {}) {
  return {
    type: 'custom-tool' as const,
    title: 'Lookup order',
    schema: storableSchema,
    code: 'return 1',
    ...overrides,
  } as Parameters<typeof persistCustomToolsToDatabase>[0][number]
}

describe('persistCustomToolsToDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsertCustomTools.mockResolvedValue([])
  })

  it('persists a storable declaration unchanged', async () => {
    const result = await persistCustomToolsToDatabase([customTool()], WORKSPACE_ID, USER_ID)

    expect(result).toEqual({ saved: 1, errors: [] })
    expect(mockUpsertCustomTools).toHaveBeenCalledWith({
      tools: [{ id: undefined, title: 'Lookup order', schema: storableSchema, code: 'return 1' }],
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    })
  })

  it('skips a declaration missing the function discriminator the public API republishes', async () => {
    const withoutType = customTool({
      title: 'No discriminator',
      schema: { function: storableSchema.function },
    })

    const result = await persistCustomToolsToDatabase([withoutType], WORKSPACE_ID, USER_ID)

    expect(result).toEqual({ saved: 0, errors: [] })
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('skips a declaration whose discriminator is not `function`', async () => {
    const wrongType = customTool({
      title: 'Wrong discriminator',
      schema: { ...storableSchema, type: 'object' },
    })

    const result = await persistCustomToolsToDatabase([wrongType], WORKSPACE_ID, USER_ID)

    expect(result).toEqual({ saved: 0, errors: [] })
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('keeps the rest of an import when one declaration is unstorable', async () => {
    const result = await persistCustomToolsToDatabase(
      [customTool({ title: 'Bad', schema: { function: storableSchema.function } }), customTool()],
      WORKSPACE_ID,
      USER_ID
    )

    expect(result).toEqual({ saved: 1, errors: [] })
    expect(mockUpsertCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ id: undefined, title: 'Lookup order', schema: storableSchema, code: 'return 1' }],
      })
    )
  })
})
