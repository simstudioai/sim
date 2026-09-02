/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadInternalFileSession } = vi.hoisted(() => ({
  mockUploadInternalFileSession: vi.fn(),
}))

vi.mock('@/lib/uploads/client/session-upload', () => ({
  uploadInternalFileSession: mockUploadInternalFileSession,
}))

import { uploadWorkflowAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-attachment-upload'

describe('uploadWorkflowAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retains distinct server-returned keys for duplicate names with different bytes', async () => {
    const first = new File(['old'], 'result.txt', { type: 'text/plain' })
    const second = new File(['new contents'], 'result.txt', { type: 'text/plain' })
    mockUploadInternalFileSession
      .mockResolvedValueOnce({
        id: 'attachment-1',
        name: 'result.txt',
        size: 3,
        type: 'text/plain',
        url: '/api/files/serve/one',
        key: 'execution/ws-1/wf-1/ex-1/receipt-one-result.txt',
        context: 'execution',
      })
      .mockResolvedValueOnce({
        id: 'attachment-2',
        name: 'result.txt',
        size: 12,
        type: 'text/plain',
        url: '/api/files/serve/two',
        key: 'execution/ws-1/wf-1/ex-1/receipt-two-result.txt',
        context: 'execution',
      })

    const uploaded = await uploadWorkflowAttachments({
      files: [
        { name: first.name, size: first.size, type: first.type, file: first },
        { name: second.name, size: second.size, type: second.type, file: second },
      ],
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      executionId: 'ex-1',
    })

    expect(uploaded.map(({ key, name, size }) => ({ key, name, size }))).toEqual([
      {
        key: 'execution/ws-1/wf-1/ex-1/receipt-one-result.txt',
        name: 'result.txt',
        size: 3,
      },
      {
        key: 'execution/ws-1/wf-1/ex-1/receipt-two-result.txt',
        name: 'result.txt',
        size: 12,
      },
    ])
  })
})
