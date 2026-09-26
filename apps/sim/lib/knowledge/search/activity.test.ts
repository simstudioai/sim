import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}))

import { recordOrganizationSearchActivity } from '@/lib/knowledge/search/activity'

beforeEach(() => {
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
  dbChainMockFns.transaction.mockImplementation((callback) =>
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
