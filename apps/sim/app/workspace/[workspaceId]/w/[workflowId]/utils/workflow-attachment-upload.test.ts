/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunUploadStrategy, mockUploadViaApiFallbackWithMetadata } = vi.hoisted(() => ({
  mockRunUploadStrategy: vi.fn(),
  mockUploadViaApiFallbackWithMetadata: vi.fn(),
}))

vi.mock('@/lib/uploads/client/direct-upload', () => ({
  DirectUploadError: class extends Error {},
  runUploadStrategy: mockRunUploadStrategy,
}))

vi.mock('@/lib/uploads/client/api-fallback', () => ({
  uploadViaApiFallbackWithMetadata: mockUploadViaApiFallbackWithMetadata,
}))

import { uploadWorkflowAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-attachment-upload'

describe('uploadWorkflowAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retains distinct server-returned keys for duplicate names with different bytes', async () => {
    const first = new File(['old'], 'result.txt', { type: 'text/plain' })
    const second = new File(['new contents'], 'result.txt', { type: 'text/plain' })
    mockRunUploadStrategy
      .mockResolvedValueOnce({
        key: 'execution/ws-1/wf-1/ex-1/receipt-one-result.txt',
        path: '/api/files/serve/one',
      })
      .mockResolvedValueOnce({
        key: 'execution/ws-1/wf-1/ex-1/receipt-two-result.txt',
        path: '/api/files/serve/two',
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
