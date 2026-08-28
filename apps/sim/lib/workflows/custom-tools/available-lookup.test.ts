/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    select: vi.fn(),
  },
}))

vi.mock('@sim/db', () => ({
  db: { select: mocks.select },
}))

import { getAvailableCustomTool } from '@/lib/workflows/custom-tools/operations'

const workspaceTool = {
  id: 'workspace-tool',
  workspaceId: 'workspace-1',
  userId: 'user-2',
  title: 'lookup_order',
}
const personalTool = {
  id: 'personal-tool',
  workspaceId: null,
  userId: 'user-1',
  title: 'lookup_order',
}

function selection(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ where })
  return { from }
}

describe('getAvailableCustomTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the workspace tool without querying the personal fallback', async () => {
    mocks.select.mockReturnValueOnce(selection([workspaceTool]))

    await expect(
      getAvailableCustomTool({
        identifier: workspaceTool.title,
        userId: personalTool.userId,
        workspaceId: workspaceTool.workspaceId,
        lookup: 'id_or_title',
      })
    ).resolves.toEqual(workspaceTool)

    expect(mocks.select).toHaveBeenCalledTimes(1)
  })

  it('queries the authenticated subject personal fallback only after a workspace miss', async () => {
    mocks.select.mockReturnValueOnce(selection([])).mockReturnValueOnce(selection([personalTool]))

    await expect(
      getAvailableCustomTool({
        identifier: personalTool.id,
        userId: personalTool.userId,
        workspaceId: workspaceTool.workspaceId,
        lookup: 'id',
      })
    ).resolves.toEqual(personalTool)

    expect(mocks.select).toHaveBeenCalledTimes(2)
  })
})
