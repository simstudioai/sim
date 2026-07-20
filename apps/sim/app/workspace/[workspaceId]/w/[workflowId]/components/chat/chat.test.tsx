/**
 * @vitest-environment jsdom
 */
import {
  act,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  chatState,
  mockAddMessage,
  mockAppendMessageContent,
  mockCreateObjectURL,
  mockFileReader,
  mockFinalizeMessageStream,
  mockHandleRunWorkflow,
  mockReadSSEEvents,
  mockRevokeObjectURL,
  WorkflowAttachmentUploadErrorMock,
} = vi.hoisted(() => {
  class WorkflowAttachmentUploadErrorMock extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkflowAttachmentUploadError'
    }
  }

  const mockAddMessage = vi.fn()
  const mockAppendMessageContent = vi.fn()
  const mockFinalizeMessageStream = vi.fn()

  return {
    chatState: {
      isChatOpen: true,
      chatPosition: null,
      chatWidth: 305,
      chatHeight: 286,
      setIsChatOpen: vi.fn(),
      setChatPosition: vi.fn(),
      setChatDimensions: vi.fn(),
      messages: [],
      addMessage: mockAddMessage,
      selectedWorkflowOutputs: {},
      setSelectedWorkflowOutput: vi.fn(),
      appendMessageContent: mockAppendMessageContent,
      finalizeMessageStream: mockFinalizeMessageStream,
      getConversationId: vi.fn(() => 'conversation-1'),
      clearChat: vi.fn(),
      exportChatCSV: vi.fn(),
    },
    mockAddMessage,
    mockAppendMessageContent,
    mockCreateObjectURL: vi.fn(),
    mockFileReader: vi.fn(),
    mockFinalizeMessageStream,
    mockHandleRunWorkflow: vi.fn(),
    mockReadSSEEvents: vi.fn(),
    mockRevokeObjectURL: vi.fn(),
    WorkflowAttachmentUploadErrorMock,
  }
})

vi.mock('@sim/emcn', () => ({
  Badge: ({
    children,
    className: _className,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Button: ({
    children,
    className: _className,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Input: ({
    ref,
    className: _className,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) => (
    <input ref={ref} {...props} />
  ),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  PopoverScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  Trash: () => <span data-icon='Trash' />,
}))

vi.mock('@sim/emcn/icons', () => ({
  Download: () => <span data-icon='Download' />,
}))

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span data-icon='AlertCircle' />,
  ArrowUp: () => <span data-icon='ArrowUp' />,
  MoreVertical: () => <span data-icon='MoreVertical' />,
  Paperclip: () => <span data-icon='Paperclip' />,
  Square: () => <span data-icon='Square' />,
  X: () => <span data-icon='X' />,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: (value: typeof chatState) => unknown) => selector,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}))

vi.mock('@/lib/core/utils/response-format', () => ({
  extractBlockIdFromOutputId: () => '',
  extractPathFromOutputId: () => '',
  parseOutputContentSafely: (value: unknown) => value,
}))

vi.mock('@/lib/core/utils/sse', () => ({
  readSSEEvents: mockReadSSEEvents,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({
  CHAT_ACCEPT_ATTRIBUTE: '*/*',
}))

vi.mock('@/lib/workflows/input-format', () => ({
  normalizeInputFormatValue: () => [],
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  StartBlockPath: { UNIFIED: 'unified' },
  TriggerUtils: { findStartBlock: () => null },
}))

vi.mock('@/lib/workflows/types', () => ({
  START_BLOCK_RESERVED_FIELDS: [],
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components', () => ({
  ChatMessage: () => null,
  OutputSelect: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks', () => ({
  usePreventZoom: () => ({ current: null }),
  useScrollManagement: () => ({
    scrollAreaRef: { current: null },
    scrollToBottom: vi.fn(),
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/float', () => ({
  useFloatBoundarySync: vi.fn(),
  useFloatDrag: () => ({ handleMouseDown: vi.fn() }),
  useFloatResize: () => ({
    cursor: null,
    handleMouseMove: vi.fn(),
    handleMouseLeave: vi.fn(),
    handleMouseDown: vi.fn(),
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution', () => ({
  isChatWorkflowRunResult: (value: unknown) =>
    Boolean(
      value &&
        typeof value === 'object' &&
        'uploadedAttachments' in value &&
        Array.isArray(value.uploadedAttachments)
    ),
  useWorkflowExecution: () => ({
    handleRunWorkflow: mockHandleRunWorkflow,
    handleCancelExecution: vi.fn(),
  }),
  WorkflowAttachmentUploadError: WorkflowAttachmentUploadErrorMock,
}))

vi.mock('@/stores/chat/store', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}))

vi.mock('@/stores/execution', () => ({
  useIsCurrentWorkflowExecuting: () => false,
}))

vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueue: () => ({ addToQueue: vi.fn() }),
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalConsoleStore: (selector: (state: { _hasHydrated: boolean }) => unknown) =>
    selector({ _hasHydrated: false }),
  useWorkflowConsoleEntries: () => [],
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (selector: (state: { activeWorkflowId: string }) => unknown) =>
    selector({ activeWorkflowId: 'workflow-1' }),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: (
    selector: (state: { workflowValues: Record<string, unknown>; setValue: () => void }) => unknown
  ) => selector({ workflowValues: {}, setValue: vi.fn() }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (
    selector: (state: { blocks: Record<string, unknown>; triggerUpdate: () => void }) => unknown
  ) => selector({ blocks: {}, triggerUpdate: vi.fn() }),
}))

vi.mock('@/stores/chat/utils', () => ({
  getChatPosition: () => ({ x: 0, y: 0 }),
}))

import { Chat } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/chat'

let container: HTMLDivElement
let root: Root
let isMounted: boolean

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function addMessageAndAttachment(message: string, file: File) {
  const messageInput = container.querySelector<HTMLInputElement>(
    'input[placeholder="Type a message..."]'
  )
  const fileInput = container.querySelector<HTMLInputElement>('#floating-chat-file-input')
  if (!messageInput || !fileInput) throw new Error('Expected chat inputs')

  await act(async () => {
    setInputValue(messageInput, message)
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

async function sendMessage() {
  const sendButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.querySelector('[data-icon="ArrowUp"]')
  )
  if (!sendButton) throw new Error('Expected send button')

  await act(async () => {
    sendButton.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('floating chat attachment uploads', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockCreateObjectURL.mockReturnValue('blob:diagram-preview')
    mockReadSSEEvents.mockResolvedValue(undefined)
    vi.stubGlobal('FileReader', mockFileReader)
    class TestURL extends URL {}
    TestURL.createObjectURL = mockCreateObjectURL
    TestURL.revokeObjectURL = mockRevokeObjectURL
    vi.stubGlobal('URL', TestURL)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    isMounted = true

    await act(async () => {
      root.render(<Chat />)
    })
  })

  afterEach(() => {
    if (isMounted) {
      act(() => root.unmount())
    }
    container.remove()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses uploaded URLs for message previews without base64 conversion', async () => {
    const file = new File(['diagram'], 'diagram.png', { type: 'image/png' })
    mockHandleRunWorkflow.mockResolvedValue({
      success: true,
      stream: new ReadableStream({ start: (controller) => controller.close() }),
      uploadedAttachments: [
        {
          id: 'uploaded-1',
          name: 'diagram.png',
          url: '/api/files/serve/execution%2Fdiagram.png',
          size: file.size,
          type: file.type,
          key: 'execution/diagram.png',
          context: 'execution',
        },
      ],
    })

    await addMessageAndAttachment('Describe this diagram', file)
    expect(mockCreateObjectURL).toHaveBeenCalledWith(file)

    await sendMessage()

    expect(mockFileReader).not.toHaveBeenCalled()
    const workflowInput = mockHandleRunWorkflow.mock.calls[0]?.[0] as Record<string, unknown>
    expect(workflowInput).not.toHaveProperty('onUploadError')
    expect(Object.values(workflowInput).some((value) => typeof value === 'function')).toBe(false)

    const userMessage = mockAddMessage.mock.calls
      .map(([message]) => message as { type: string; attachments?: unknown[] })
      .find((message) => message.type === 'user')
    expect(userMessage?.attachments).toEqual([
      {
        id: 'uploaded-1',
        filename: 'diagram.png',
        media_type: 'image/png',
        size: file.size,
        previewUrl: '/api/files/serve/execution%2Fdiagram.png',
      },
    ])
    expect(container.textContent).not.toContain('diagram.png')
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Type a message..."]')?.value
    ).toBe('')
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:diagram-preview')
  })

  it('surfaces the exact error and preserves text and files for retry', async () => {
    const file = new File(['report'], 'report.png', { type: 'image/png' })
    mockHandleRunWorkflow.mockRejectedValue(
      new WorkflowAttachmentUploadErrorMock(
        'Failed to upload report.png: Workspace file storage limit exceeded'
      )
    )

    await addMessageAndAttachment('Summarize this report', file)
    await sendMessage()

    expect(mockFileReader).not.toHaveBeenCalled()
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Type a message..."]')?.value
    ).toBe('Summarize this report')
    expect(container.querySelector('img[alt="report.png"]')).not.toBeNull()
    expect(container.textContent).toContain(
      'Failed to upload report.png: Workspace file storage limit exceeded'
    )
    expect(
      mockAddMessage.mock.calls.some(([message]) => (message as { type?: string }).type === 'user')
    ).toBe(false)
    expect(mockRevokeObjectURL).not.toHaveBeenCalled()

    act(() => root.unmount())
    isMounted = false
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:diagram-preview')
  })
})
