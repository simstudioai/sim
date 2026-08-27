/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockInvalidateQueries, mockUploadKnowledgeDocumentSession } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockUploadKnowledgeDocumentSession: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock('@/lib/uploads/client/session-upload', () => ({
  uploadKnowledgeDocumentSession: mockUploadKnowledgeDocumentSession,
}))

import { MULTI_FILE_UPLOAD_MAX_FILE_BYTES } from '@/lib/uploads/client/admission'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'

interface HookHarness {
  result: () => ReturnType<typeof useKnowledgeUpload>
  unmount: () => void
}

function renderKnowledgeUploadHook(onError: ReturnType<typeof vi.fn>): HookHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root: Root = createRoot(document.createElement('div'))
  let latest: ReturnType<typeof useKnowledgeUpload>

  function Probe() {
    latest = useKnowledgeUpload({ workspaceId: 'workspace-1', onError })
    return null
  }

  act(() => root.render(<Probe />))
  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

function sizedFile(name: string, size: number): File {
  const file = new File([], name, { type: 'application/octet-stream' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('useKnowledgeUpload admission', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects aggregate bytes before allocating upload progress or sessions', async () => {
    const onError = vi.fn()
    const { result, unmount } = renderKnowledgeUploadHook(onError)
    const files = Array.from({ length: 6 }, (_, index) =>
      sizedFile(`file-${index}.bin`, MULTI_FILE_UPLOAD_MAX_FILE_BYTES)
    )

    await act(async () => {
      await expect(result().uploadFiles(files, 'kb-1')).rejects.toMatchObject({
        code: 'UPLOAD_TOTAL_SIZE_EXCEEDED',
      })
    })

    expect(mockUploadKnowledgeDocumentSession).not.toHaveBeenCalled()
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
    expect(result().isUploading).toBe(false)
    expect(result().uploadProgress).toEqual({
      stage: 'idle',
      filesCompleted: 0,
      totalFiles: 0,
    })
    expect(result().uploadError).toMatchObject({
      code: 'UPLOAD_TOTAL_SIZE_EXCEEDED',
      message: 'Select files totaling 500 MiB or less.',
    })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UPLOAD_TOTAL_SIZE_EXCEEDED' })
    )

    unmount()
  })

  /**
   * A partial batch failure still created every document that DID upload, so the caches have
   * to reconcile on the throwing path too — otherwise the list renders without rows the
   * server already has.
   */
  it('reconciles the caches when part of a batch fails', async () => {
    const onError = vi.fn()
    const { result, unmount } = renderKnowledgeUploadHook(onError)
    mockUploadKnowledgeDocumentSession
      .mockResolvedValueOnce({ id: 'doc-1', filename: 'ok.bin' })
      .mockRejectedValueOnce(new Error('network died'))

    await act(async () => {
      await expect(
        result().uploadFiles([sizedFile('ok.bin', 10), sizedFile('bad.bin', 10)], 'kb-1')
      ).rejects.toMatchObject({ code: 'PARTIAL_UPLOAD_FAILURE' })
    })

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge', 'detail', 'kb-1'],
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['knowledge', 'list'] })

    unmount()
  })
})
