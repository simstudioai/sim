/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CHAT_FILE_SIZE_BYTES,
  MAX_CHAT_FILES,
  useChatFileUpload,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/hooks/use-chat-file-upload'

interface HookHarness {
  result: () => ReturnType<typeof useChatFileUpload>
  unmount: () => void
}

function renderChatFileUploadHook(): HookHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: ReturnType<typeof useChatFileUpload>

  function Probe() {
    latest = useChatFileUpload()
    return null
  }

  act(() => {
    root.render(<Probe />)
  })

  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

describe('useChatFileUpload execution errors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('surfaces the exact upload error while retaining the attachment for retry', () => {
    const { result, unmount } = renderChatFileUploadHook()
    const file = new File(['report'], 'report.pdf', { type: 'application/pdf' })

    act(() => {
      result().addFiles([file])
      vi.runAllTimers()
    })

    act(() => {
      result().reportUploadError(
        'Failed to upload report.pdf: Workspace file storage limit exceeded'
      )
    })

    expect(result().uploadErrors).toEqual([
      'Failed to upload report.pdf: Workspace file storage limit exceeded',
    ])
    expect(result().chatFiles).toHaveLength(1)
    expect(result().chatFiles[0].file).toBe(file)

    unmount()
  })

  it('retains at most fifteen explicit attachments', () => {
    const { result, unmount } = renderChatFileUploadHook()
    const files = Array.from(
      { length: MAX_CHAT_FILES + 1 },
      (_, index) => new File([`${index}`], `file-${index}.txt`, { type: 'text/plain' })
    )

    act(() => {
      result().addFiles(files)
      vi.runAllTimers()
    })

    expect(result().chatFiles).toHaveLength(MAX_CHAT_FILES)

    unmount()
  })

  it('rejects attachments larger than ten megabytes', () => {
    const { result, unmount } = renderChatFileUploadHook()
    const file = new File(['oversized'], 'oversized.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: MAX_CHAT_FILE_SIZE_BYTES + 1 })

    act(() => {
      result().addFiles([file])
      vi.runAllTimers()
    })

    expect(result().chatFiles).toHaveLength(0)
    expect(result().uploadErrors).toEqual(['oversized.pdf is too large (max 10MB)'])

    unmount()
  })
})
