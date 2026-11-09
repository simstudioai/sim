import { type Mock, vi } from 'vitest'

/**
 * The legacy chat modules an organization conversation renders, for tests of the conversation's own
 * behavior. Each default renders nothing or passes children through; a test sets what it asserts on.
 */
export const organizationConversationMockFns = {
  mockUseChat: vi.fn(),
  mockMothershipChat: vi.fn(),
  mockChatResourcePanel: vi.fn(({ children }: { children?: unknown }) => children) as Mock,
  mockUseResourcePanelController: vi.fn(() => ({
    onResourceEvent: undefined,
    activeResourceState: [null, vi.fn()] as unknown,
    activeResourceParam: null as string | null,
    setActiveResourceUrl: vi.fn() as unknown,
  })),
  mockUseChatResourcePanel: vi.fn(() => ({
    isResourceCollapsed: true,
    addResourceFromUser: vi.fn() as unknown,
    prepareResourceViewForAgentTurn: vi.fn(),
  })),
  mockMarkMothershipChatRead: vi.fn(),
}

const fns = organizationConversationMockFns

/** `@/hooks/mothership-chat/use-chat` */
export const useChatMock = {
  getMothershipUseChatOptions: (options: object) => ({ ...options, mothership: true }),
  useChat: fns.mockUseChat,
}

/** `@/hooks/mothership-chat/use-resource-panel` */
export const useResourcePanelMock = {
  useResourcePanelController: fns.mockUseResourcePanelController,
  useChatResourcePanel: fns.mockUseChatResourcePanel,
}

/** `@/components/mothership-chat/mothership-chat` */
export const mothershipChatMock = { MothershipChat: fns.mockMothershipChat }

/** `@/components/mothership-chat/chat-resource-panel` */
export const chatResourcePanelMock = { ChatResourcePanel: fns.mockChatResourcePanel }

/** `@/hooks/queries/mothership-chats` */
export const mothershipChatsQueriesMock = {
  useMarkMothershipChatRead: () => ({ mutate: fns.mockMarkMothershipChatRead }),
  useMothershipChatHistory: () => ({ data: undefined }),
  useSetMothershipChatEffort: () => ({ mutate: vi.fn() }),
}
