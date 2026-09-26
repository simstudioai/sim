import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudId: vi.fn(),
}))

vi.mock('@/tools/jira/utils', () => ({
  getJiraCloudId: mocks.getCloudId,
}))

import { createJiraClient } from '@/lib/internal/jira/client'

describe('JiraClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    mocks.getCloudId.mockResolvedValue('cloud-1')
  })

  it('rejects malformed attachment cloud IDs before constructing request URLs', async () => {
    await expect(
      createJiraClient(
        {
          accessToken: 'token',
          domain: 'example.atlassian.net',
          cloudId: '../rest/api/3',
        },
        { validateCloudId: true }
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
