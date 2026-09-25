import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@sim/db', () => ({ db: { transaction: mocks.transaction } }))

import {
  recordOrganizationSearchMcpActivity,
  type SearchMcpActivityInput,
} from '@/lib/knowledge/mcp/activity'

const activity: SearchMcpActivityInput = {
  organizationId: 'org',
  userId: 'actor',
  authKind: 'personal_api_key',
  oauthClientId: null,
  clientName: null,
  toolName: 'read_document',
  outcome: 'success',
  durationMs: 42,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => {
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation((callback) =>
    callback({ execute: mocks.execute, insert: mocks.insert })
  )
})

describe('persistent MCP activity', () => {
  it('only persists the allowlisted metadata when extra content is present', async () => {
    const input = {
      ...activity,
      query: 'private question',
      content: 'private document',
      token: 'private token',
    }
    await recordOrganizationSearchMcpActivity(input)
    expect(mocks.values).toHaveBeenCalledExactlyOnceWith({
      id: expect.any(String),
      ...activity,
      clientName: null,
    })
  })

  it('does not insert when the deadline could not be established', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('unavailable'))
    await expect(recordOrganizationSearchMcpActivity(activity)).resolves.toBeUndefined()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not propagate storage failures into the request lifecycle', async () => {
    mocks.values.mockRejectedValueOnce(new Error('offline'))
    await expect(recordOrganizationSearchMcpActivity(activity)).resolves.toBeUndefined()
  })
})
