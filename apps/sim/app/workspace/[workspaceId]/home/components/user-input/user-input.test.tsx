/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
}))

vi.mock('@/blocks/integration-matcher', () => ({
  mentionifyIntegrations: (text: string) => text,
}))

vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: vi.fn() }),
}))

vi.mock('@/hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: false,
    resetTranscript: vi.fn(),
    toggleListening: vi.fn(),
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => ({
    userId: 'user-1',
    onContextAdd: vi.fn(),
    onContextRemove: vi.fn(),
  }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks',
  () => ({
    useFileAttachments: () => ({
      attachedFiles: [],
      clearAttachedFiles: vi.fn(),
      fileInputRef: { current: null },
      handleDragEnter: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDragOver: vi.fn(),
      handleDrop: vi.fn(),
      handleFileChange: vi.fn(),
      handleFileClick: vi.fn(),
      handleFileSelect: vi.fn(),
      isDragging: false,
      processFiles: vi.fn(),
      removeFile: vi.fn(),
      restoreAttachedFiles: vi.fn(),
    }),
  })
)

vi.mock('@/app/workspace/[workspaceId]/home/components/user-input/components', () => ({
  AnimatedPlaceholderEffect: () => null,
  AttachedFilesList: () => null,
  DropOverlay: () => null,
  MicButton: () => null,
  PromptEditor: ({ className }: { className?: string }) => (
    <div data-testid='prompt-editor' className={className} />
  ),
  SendButton: () => null,
  usePromptEditor: () => ({
    clear: vi.fn(),
    contexts: [],
    focusAtEnd: vi.fn(),
    getActiveContexts: () => [],
    getPlainValue: () => '',
    getValue: () => '',
    insertResources: vi.fn(),
    insertSlashTrigger: vi.fn(),
    openResourceMenu: vi.fn(),
    setContexts: vi.fn(),
    setValue: vi.fn(),
    textareaRef: { current: null },
    value: '',
  }),
}))

import { UserInput } from '@/app/workspace/[workspaceId]/home/components/user-input/user-input'

interface RenderUserInputOptions {
  isInitialView?: boolean
}

function renderUserInput({ isInitialView }: RenderUserInputOptions = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  act(() => {
    root.render(
      <UserInput
        isInitialView={isInitialView}
        isSending={false}
        onStopGeneration={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
  })

  return {
    editor: container.querySelector('[data-testid="prompt-editor"]'),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('UserInput prompt sizing', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('grows the initial composer from its 56px resting height to the 200px cap', () => {
    const { editor, unmount } = renderUserInput()

    expect(editor).toHaveClass('min-h-[56px]', 'max-h-[200px]')
    expect(editor).not.toHaveClass('h-[56px]')
    unmount()
  })

  it('keeps the active composer capped at 200px without the initial-view height floor', () => {
    const { editor, unmount } = renderUserInput({ isInitialView: false })

    expect(editor).toHaveClass('max-h-[200px]')
    expect(editor).not.toHaveClass('min-h-[56px]', 'h-[56px]')
    unmount()
  })
})
