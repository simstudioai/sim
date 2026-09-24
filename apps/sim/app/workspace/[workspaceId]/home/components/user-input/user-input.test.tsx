/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptEditorInstance } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

const { mockSubmit, mockResetTranscript } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
  mockResetTranscript: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/home',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: vi.fn() }))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: vi.fn() }),
}))
vi.mock('@/hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({ isSupported: false, resetTranscript: mockResetTranscript }),
}))
vi.mock('@/hooks/queries/skills', () => ({ useSkills: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMothershipChatHistory: () => ({ data: undefined }),
}))
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
  mentionifyIntegrations: (text: string) => text,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => ({}),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments',
  async () => {
    const { useRef, useState } = await import('react')
    return {
      useFileAttachments: () => {
        const [attachedFiles, restoreAttachedFiles] = useState<
          import('@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments').AttachedFile[]
        >([])
        return {
          attachedFiles,
          restoreAttachedFiles,
          clearAttachedFiles: () => restoreAttachedFiles([]),
          fileInputRef: useRef<HTMLInputElement>(null),
          isDragging: false,
        }
      },
    }
  }
)
vi.mock('@/app/workspace/[workspaceId]/home/components/user-input/components', async () => {
  const { usePromptEditor } = await import(
    '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
  )
  return {
    usePromptEditor,
    PromptEditor: ({
      editor,
      placeholder,
      onSubmit,
    }: {
      editor: PromptEditorInstance
      placeholder: string
      onSubmit: () => void
    }) => (
      <textarea
        ref={editor.textareaRef}
        value={editor.value}
        placeholder={placeholder}
        onChange={editor.handleInputChange}
        onKeyDown={(event) => editor.handleKeyDown(event, { onSubmit })}
      />
    ),
    SendButton: ({ onSubmit }: { onSubmit: () => void }) => (
      <button type='button' onClick={onSubmit}>
        Send
      </button>
    ),
    AnimatedPlaceholderEffect: () => null,
    AttachedFilesList: () => null,
    DropOverlay: () => null,
    MicButton: () => null,
    MicrophonePermissionHelp: () => null,
  }
})

import {
  UserInput,
  type UserInputHandle,
} from '@/app/workspace/[workspaceId]/home/components/user-input/user-input'

const mockUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
const QUEUED_MESSAGE: QueuedMessage = {
  id: 'queued-1',
  content: 'Write the report',
  fileAttachments: [
    { id: 'file-1', key: 'file-key', filename: 'notes.txt', media_type: 'text/plain', size: 12 },
  ],
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(isSending = false, onSendQueuedHead?: () => void) {
  const inputRef = createRef<UserInputHandle>()

  function Composer() {
    return (
      <>
        <button
          type='button'
          onClick={() => {
            inputRef.current?.loadQueuedMessage(QUEUED_MESSAGE)
          }}
        >
          Edit queued
        </button>
        <UserInput
          ref={inputRef}
          defaultValue='Initial draft'
          onSubmit={mockSubmit}
          isSending={isSending}
          onSendQueuedHead={onSendQueuedHead}
          onStopGeneration={vi.fn()}
        />
      </>
    )
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <NuqsTestingAdapter
        hasMemory
        searchParams='?mode=search&q=budget&source=upload&updated=7d&resource=report'
        onUrlUpdate={mockUrlUpdate}
      >
        <FeatureFlagsProvider
          flags={{
            'table-row-ttl': false,
            'mothership-model-selector': false,
            'mothership-plan-mode': false,
          }}
        >
          <Composer />
        </FeatureFlagsProvider>
      </NuqsTestingAdapter>
    )
  })
  return inputRef
}

function textarea() {
  const input = container?.querySelector('textarea')
  if (!input) throw new Error('Composer did not render')
  return input
}

async function clickButton(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent === label
  )
  if (!button) throw new Error(`Button ${label} did not render`)
  await act(async () => {
    button.click()
    await vi.advanceTimersByTimeAsync(1)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockSubmit.mockClear()
  mockUrlUpdate.mockClear()
  mockResetTranscript.mockClear()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('workspace composer', () => {
  it('keeps workspace controls and ignores legacy search-mode URLs', () => {
    mount()
    expect(textarea().value).toBe('Initial draft')
    expect(textarea().placeholder).toBe('Ask Sim to ')
    expect(container?.querySelector('[aria-label^="Mode:"]')).toBeNull()
    for (const label of ['Add resources', 'Attach file', 'Skills']) {
      expect(container?.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
    }
    expect(mockUrlUpdate).not.toHaveBeenCalled()
  })

  it('retains queued content and attachments when editing, then clears after sending', async () => {
    mount()
    await clickButton('Edit queued')
    expect(textarea().value).toBe(QUEUED_MESSAGE.content)
    await clickButton('Send')
    expect(mockSubmit).toHaveBeenCalledWith(
      QUEUED_MESSAGE.content,
      QUEUED_MESSAGE.fileAttachments,
      undefined
    )
    expect(textarea().value).toBe('')
    expect(mockResetTranscript).toHaveBeenCalled()
  })
})

it.each([false, true])(
  'sends a queued message on the second Enter without resubmitting attachments (%s)',
  async (withAttachment) => {
    const sendHead = vi.fn()
    mount(true, sendHead)
    if (withAttachment) await clickButton('Edit queued')
    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(mockSubmit).toHaveBeenCalledTimes(1)
    expect(sendHead).toHaveBeenCalledExactlyOnceWith()
    expect(textarea().value).toBe('')
  }
)
