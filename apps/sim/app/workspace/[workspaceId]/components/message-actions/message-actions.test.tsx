/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  params: {} as { organizationId?: string; workspaceId?: string },
  push: vi.fn(),
  fork: vi.fn(),
  useFork: vi.fn(),
  clearChatSelection: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@sim/emcn', () => ({
  Check: () => null,
  Duplicate: () => null,
  Split: () => null,
  ThumbsDown: () => null,
  ThumbsUp: () => null,
  ChipModal: () => null,
  ChipModalBody: () => null,
  ChipModalField: () => null,
  ChipModalFooter: () => null,
  ChipModalHeader: () => null,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: () => null,
  },
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  toast: { warning: vi.fn(), error: vi.fn() },
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => ({ chatId: 'parent-chat' }),
}))

vi.mock('@/hooks/queries/copilot-feedback', () => ({
  useSubmitCopilotFeedback: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/hooks/queries/mothership-chats', () => ({
  useForkMothershipChat: mocks.useFork,
}))

vi.mock('@/stores/folders/store', () => ({
  useFolderStore: { getState: () => ({ clearChatSelection: mocks.clearChatSelection }) },
}))

import { MessageActions } from '@/app/workspace/[workspaceId]/components/message-actions/message-actions'

describe('MessageActions fork navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params = {}
    mocks.fork.mockResolvedValue({ id: 'forked-chat' })
    mocks.useFork.mockReturnValue({ mutateAsync: mocks.fork, isPending: false })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderActions() {
    await act(async () => {
      root.render(
        <MessageActions content='An answer' messageId='persisted-message' userQuery={undefined} />
      )
    })
  }

  async function forkChat() {
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Fork in new chat"]')
    expect(button).not.toBeNull()
    await act(async () => button?.click())
  }

  it('keeps an organization fork in its organization and leaves workspace selection untouched', async () => {
    mocks.params = { organizationId: 'organization-1' }
    await renderActions()
    await forkChat()

    expect(mocks.useFork).toHaveBeenCalledWith({ organizationId: 'organization-1' })
    expect(mocks.fork).toHaveBeenCalledWith({
      chatId: 'parent-chat',
      upToMessageId: 'persisted-message',
    })
    expect(mocks.push).toHaveBeenCalledWith('/o/organization-1/chat/forked-chat')
    expect(mocks.clearChatSelection).not.toHaveBeenCalled()
  })

  it('preserves workspace fork navigation and clears the workspace chat selection', async () => {
    mocks.params = { workspaceId: 'workspace-1' }
    await renderActions()
    await forkChat()

    expect(mocks.useFork).toHaveBeenCalledWith('workspace-1')
    expect(mocks.push).toHaveBeenCalledWith('/workspace/workspace-1/chat/forked-chat')
    expect(mocks.clearChatSelection).toHaveBeenCalledOnce()
  })

  it('does not offer a fork when the route has no owner scope', async () => {
    await renderActions()

    expect(container.querySelector('[aria-label="Fork in new chat"]')).toBeNull()
    expect(mocks.fork).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
