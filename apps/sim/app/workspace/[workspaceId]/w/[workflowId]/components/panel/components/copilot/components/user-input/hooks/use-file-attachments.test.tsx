/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToastError, mockUploadInternalFileSession } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUploadInternalFileSession: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({ toast: { error: mockToastError } }))

vi.mock('@/lib/uploads/client/session-upload', () => ({
  uploadInternalFileSession: mockUploadInternalFileSession,
}))

import {
  ASSISTANT_IMAGE_MAX_BYTES,
  ASSISTANT_IMAGE_MAX_COUNT,
} from '@/lib/uploads/shared/assistant-images'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

interface HookHarness {
  result: () => ReturnType<typeof useFileAttachments>
  unmount: () => void
}

function renderFileAttachmentsHook(
  owner: { workspaceId: string } | { organizationId: string } = { workspaceId: 'workspace-1' }
): HookHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root: Root = createRoot(document.createElement('div'))
  let latest: ReturnType<typeof useFileAttachments>

  function Probe() {
    latest = useFileAttachments({ userId: 'user-1', ...owner })
    return null
  }

  act(() => root.render(<Probe />))
  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

function sizedFile(name: string, size: number): File {
  const file = new File([], name, { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function asFileList(files: File[]): FileList {
  return Object.assign(files, { item: (index: number) => files[index] ?? null })
}

describe('useFileAttachments admission', () => {
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const createObjectUrl = vi.fn()

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
  })

  it('rejects aggregate bytes before previews, placeholders, or sessions are allocated', async () => {
    const { result, unmount } = renderFileAttachmentsHook()
    const files = asFileList([
      ...Array.from({ length: 5 }, (_, index) =>
        sizedFile(`large-image-${index}.png`, MAX_WORKSPACE_FILE_SIZE)
      ),
      sizedFile('extra-image.png', 1),
    ])

    await act(async () => {
      await result().processFiles(files)
    })

    expect(mockToastError).toHaveBeenCalledWith("Couldn't add files", {
      description: 'Select files totaling 25 GiB or less.',
    })
    expect(createObjectUrl).not.toHaveBeenCalled()
    expect(mockUploadInternalFileSession).not.toHaveBeenCalled()
    expect(result().attachedFiles).toEqual([])

    unmount()
  })

  it('starts a mothership session for a file above the old FormData limit', async () => {
    mockUploadInternalFileSession.mockResolvedValue({
      path: '/api/files/serve/s3/mothership%2Flarge-image.png?context=mothership',
      key: 'mothership/large-image.png',
    })
    const { result, unmount } = renderFileAttachmentsHook()
    const file = sizedFile('large-image.png', 101 * 1024 * 1024)

    await act(async () => {
      await result().processFiles(asFileList([file]))
    })

    expect(mockUploadInternalFileSession).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'mothership_attachment', file })
    )
    expect(result().attachedFiles).toEqual([
      expect.objectContaining({ name: file.name, uploading: false }),
    ])

    unmount()
  })

  it.each(['unsupported', 'oversized', 'too many'] as const)(
    'rejects %s organization images before allocating previews or sessions',
    async (kind) => {
      const { result, unmount } = renderFileAttachmentsHook({ organizationId: 'organization-1' })
      const files =
        kind === 'unsupported'
          ? [new File(['pdf'], 'document.pdf', { type: 'application/pdf' })]
          : kind === 'oversized'
            ? [sizedFile('large.png', ASSISTANT_IMAGE_MAX_BYTES + 1)]
            : Array.from({ length: ASSISTANT_IMAGE_MAX_COUNT + 1 }, (_, index) =>
                sizedFile(`image-${index}.png`, 10)
              )
      await act(async () => result().processFiles(asFileList(files)))
      expect(mockToastError).toHaveBeenCalledOnce()
      expect(createObjectUrl).not.toHaveBeenCalled()
      expect(mockUploadInternalFileSession).not.toHaveBeenCalled()
      expect(result().attachedFiles).toEqual([])
      unmount()
    }
  )

  it('uses organization scope for images and removes a failed upload', async () => {
    mockUploadInternalFileSession.mockRejectedValueOnce(new Error('Upload failed'))
    const { result, unmount } = renderFileAttachmentsHook({ organizationId: 'organization-1' })
    const file = sizedFile('screenshot.png', 10)
    await act(async () => result().processFiles(asFileList([file])))
    expect(mockUploadInternalFileSession).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'mothership_attachment',
        organizationId: 'organization-1',
        file,
      })
    )
    expect(mockUploadInternalFileSession.mock.calls[0][0]).not.toHaveProperty('workspaceId')
    expect(result().attachedFiles).toEqual([])
    expect(mockToastError).toHaveBeenCalledWith('Couldn\'t upload "screenshot.png"', {
      description: 'Upload failed',
    })
    unmount()
  })
})
