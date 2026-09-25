import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createClient: vi.fn(),
  downloadFile: vi.fn(),
  processFiles: vi.fn(),
  request: vi.fn(),
}))

vi.mock('@/lib/internal/jira/client', () => ({
  createJiraClient: mocks.createClient,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadFile,
}))

import { executeJiraAddAttachment, executeJiraWrite } from '@/lib/internal/jira/operations'

const client = {
  cloudId: 'cloud-1',
  issuePath: (path = '') => `https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue${path}`,
  request: mocks.request,
}

const context = {
  userId: 'user-1',
  requestId: 'request-1',
  signal: new AbortController().signal,
}

describe('Jira operations', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue(client)
    mocks.assertAccess.mockResolvedValue(null)
    mocks.processFiles.mockReturnValue([
      { key: 'workspace/file.txt', name: 'file.txt', size: 4, type: 'text/plain' },
    ])
    mocks.downloadFile.mockResolvedValue({
      buffer: Buffer.from('test'),
      contentType: 'text/plain',
    })
  })

  it('creates Jira fields, then preserves non-fatal assignment behavior', async () => {
    mocks.request
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        text: '{"id":"100","key":"PROJ-1","self":"jira-self","fields":{"summary":"Created"}}',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: 'denied',
      })

    const result = await executeJiraWrite(
      {
        accessToken: 'token',
        domain: 'example.atlassian.net',
        projectId: 'PROJ',
        summary: 'Created',
        issueType: 'Bug',
        assignee: 'account-1',
        priority: 'High',
        labels: ['customer'],
      },
      context
    )

    const createInit = mocks.request.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(createInit.body))).toEqual({
      fields: {
        project: { key: 'PROJ' },
        issuetype: { name: 'Bug' },
        summary: 'Created',
        priority: { name: 'High' },
        labels: ['customer'],
      },
    })
    expect(mocks.request.mock.calls[1]?.[0]).toContain('/PROJ-1/assignee')
    expect(result.output).toMatchObject({
      id: '100',
      issueKey: 'PROJ-1',
      summary: 'Created',
      url: 'https://example.atlassian.net/browse/PROJ-1',
    })
    expect(result.output).not.toHaveProperty('assigneeId')
  })

  it('rejects unsafe attachment issue keys before file or provider work', async () => {
    await expect(
      executeJiraAddAttachment(
        {
          accessToken: 'token',
          domain: 'example.atlassian.net',
          issueKey: '../project',
          files: [{ key: 'workspace/file.txt', name: 'file.txt', size: 4 }],
        },
        context
      )
    ).rejects.toMatchObject({ status: 400 })

    expect(mocks.processFiles).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('fails closed when attachment access is denied', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    await expect(
      executeJiraAddAttachment(
        {
          accessToken: 'token',
          domain: 'example.atlassian.net',
          issueKey: 'PROJ-1',
          files: [{ key: 'workspace/file.txt', name: 'file.txt', size: 4 }],
        },
        context
      )
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'File not found' },
    })
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
