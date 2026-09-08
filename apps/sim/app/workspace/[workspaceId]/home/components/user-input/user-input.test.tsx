/**
 * @vitest-environment jsdom
 */
import { act, createRef, useRef } from 'react'
import { useQueryState } from 'nuqs'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptEditorInstance } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor'
import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'

const { mockSubmit, mockResetTranscript, mockMemberAccessAvailable } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
  mockResetTranscript: vi.fn(),
  /** Search mode exists only where per-member access is on; these tests are that workspace. */
  mockMemberAccessAvailable: vi.fn(() => true),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/home',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: vi.fn() }))
vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mockMemberAccessAvailable(),
}))
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
  const { ModeSwitcher } = await import(
    '@/app/workspace/[workspaceId]/home/components/user-input/components/mode-switcher/mode-switcher'
  )
  return {
    usePromptEditor,
    ModeSwitcher,
    PromptEditor: ({
      editor,
      placeholder,
    }: {
      editor: PromptEditorInstance
      placeholder: string
    }) => (
      <textarea
        ref={editor.textareaRef}
        value={editor.value}
        placeholder={placeholder}
        onChange={editor.handleInputChange}
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
import { useMothershipMode } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-mode'
import { searchQueryParam } from '@/app/workspace/[workspaceId]/home/search-params'

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

function mount(requestMode?: QueuedMessage['requestMode']) {
  const inputRef = createRef<UserInputHandle>()

  function Composer() {
    const [mode, setMode] = useMothershipMode()
    const [query] = useQueryState(searchQueryParam.key, searchQueryParam.parser)
    const modes = useRef<string[]>([])
    modes.current.push(`${mode}:${query ?? ''}`)
    return (
      <>
        <output>{modes.current.join('|')}</output>
        <button
          type='button'
          onClick={() => {
            void setMode(requestMode === 'assistant' ? 'assistant' : 'build')
            inputRef.current?.loadQueuedMessage({ ...QUEUED_MESSAGE, requestMode })
          }}
        >
          Edit queued
        </button>
        <UserInput
          ref={inputRef}
          defaultValue={query ?? ''}
          onSubmit={mockSubmit}
          isSending={false}
          onStopGeneration={vi.fn()}
          canSearch
          clearOnSubmit={mode !== 'search'}
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
        <Composer />
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

async function selectMode(label: string) {
  const trigger = container?.querySelector('[aria-label="Mode: Search"]')
  if (!trigger) throw new Error('Mode switcher did not render')
  act(() => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  })
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent === label
  )
  if (!item) throw new Error(`Mode ${label} did not render`)
  await act(async () => {
    item.click()
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

describe('search composer transitions', () => {
  it.each(['Build', 'Assistant'])('clears the query when the menu selects %s', async (mode) => {
    mount()
    expect(textarea().value).toBe('budget')
    expect(textarea().placeholder).toBe('Search your documents…')

    await selectMode(mode)

    expect(textarea().value).toBe('')
    expect(textarea().placeholder).toBe(
      mode === 'Assistant' ? 'Ask about your documents or take action…' : 'Ask Sim to '
    )
    expect(mockUrlUpdate.mock.lastCall?.[0].searchParams.has('q')).toBe(false)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it.each([undefined, 'assistant'] as const)(
    'retains queued content and files after restoring request mode %s',
    async (requestMode) => {
      mount(requestMode)

      await clickButton('Edit queued')

      expect(textarea().value).toBe(QUEUED_MESSAGE.content)
      expect(container?.querySelector('output')?.textContent).not.toContain('build:budget')
      expect(mockUrlUpdate.mock.lastCall?.[0].searchParams.toString()).toBe(
        requestMode === 'assistant'
          ? 'mode=assistant&resource=report'
          : 'mode=build&resource=report'
      )
      await clickButton('Send')
      expect(mockSubmit).toHaveBeenCalledWith(
        QUEUED_MESSAGE.content,
        requestMode === 'assistant' ? undefined : QUEUED_MESSAGE.fileAttachments,
        undefined
      )
    }
  )

  it('starts a clean composer when changing modes', async () => {
    const inputRef = mount()
    act(() => inputRef.current?.loadQueuedMessage({ ...QUEUED_MESSAGE, content: 'budget' }))

    await selectMode('Build')
    await clickButton('Send')

    expect(mockSubmit).toHaveBeenCalledWith('', undefined, undefined)
  })
})
