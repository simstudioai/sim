/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@sim/db', () => ({ db: { transaction: mocks.transaction } }))

import { recordOrganizationSearchActivity } from '@/lib/knowledge/search/activity'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation((callback) =>
    callback({ execute: mocks.execute, insert: mocks.insert })
  )
})

describe('Search activity metering', () => {
  it('counts documents once per invocation and stores no document identity or content', async () => {
    await recordOrganizationSearchActivity({
      organizationId: 'org',
      userId: 'actor',
      surface: 'mcp',
      results: [
        { documentId: 'private-document-1', connectorType: 'confluence' },
        { documentId: 'private-document-1', connectorType: 'confluence' },
        { documentId: 'private-document-2', connectorType: 'jira' },
        { documentId: 'private-document-3', connectorType: null },
      ],
    })
    expect(mocks.values).toHaveBeenCalledWith({
      id: expect.any(String),
      organizationId: 'org',
      userId: 'actor',
      surface: 'mcp',
      sourceTypes: ['confluence', 'jira', 'uploads'],
      resultCount: 3,
    })
    expect(JSON.stringify(mocks.values.mock.calls)).not.toContain('private-document')
  })
  it('records successful empty searches', async () => {
    await recordOrganizationSearchActivity({
      organizationId: 'org',
      userId: 'actor',
      surface: 'dashboard',
      results: [],
    })
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ resultCount: 0, sourceTypes: [] })
    )
  })
  it('applies a transaction-local statement deadline before inserting activity', async () => {
    const timeout = Promise.withResolvers<void>()
    mocks.execute.mockReturnValueOnce(timeout.promise)
    const recorded = recordOrganizationSearchActivity({
      organizationId: 'org',
      userId: 'actor',
      surface: 'slack',
      results: [],
    })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.execute.mock.calls[0])).toContain(
      "SET LOCAL statement_timeout = '2s'"
    )
    timeout.resolve()
    await recorded
    expect(mocks.insert).toHaveBeenCalledOnce()
  })
  it('does not attempt an unbounded insert if setting the deadline fails', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Could not set statement timeout'))
    await expect(
      recordOrganizationSearchActivity({
        organizationId: 'org',
        userId: 'actor',
        surface: 'slack',
        results: [],
      })
    ).resolves.toBeUndefined()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('does not fail Search when activity storage is unavailable', async () => {
    mocks.values.mockRejectedValueOnce(new Error('offline'))
    await expect(
      recordOrganizationSearchActivity({
        organizationId: 'org',
        userId: 'actor',
        surface: 'dashboard',
        results: [],
      })
    ).resolves.toBeUndefined()
  })
})
