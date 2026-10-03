import { vi } from 'vitest'

/** Real `organizationChatOperations` definitions from `@/lib/mothership/chat/organization-chats`. */
const ORGANIZATION_CHAT_OPERATIONS = {
  subscribe: {
    id: 'organization.chats.subscribe',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  },
  read: {
    id: 'organization.chats.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  },
  list: {
    id: 'organization.chats.list',
    minimumRole: 'member',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    capability: 'copilot.use',
  },
  create: {
    id: 'organization.chats.create',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  },
} as const

/** Real `organizationChatDelegationOperations` definitions (audiences copied literally). */
const ORGANIZATION_CHAT_DELEGATION_OPERATIONS = {
  cancel: {
    id: 'organization.chats.cancel',
    minimumRole: 'member',
    principalKinds: ['session', 'organization_delegated'],
    capability: 'none',
    delegationAudience: 'sim:copilot-cancel',
    delegatedServices: ['copilot'],
  },
  settings: {
    id: 'organization.chats.settings',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
  },
  workspaces: {
    id: 'organization.chats.workspaces',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:workspaces',
    delegatedServices: ['copilot'],
  },
  knowledge: {
    id: 'organization.chats.knowledge',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:knowledge',
    delegatedServices: ['copilot'],
  },
  secrets: {
    id: 'organization.chats.secrets',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:organization-secrets',
    delegatedServices: ['copilot'],
  },
  billing: {
    id: 'organization.chats.admit',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    capability: 'copilot.use',
    delegationAudience: 'sim:copilot-billing',
    delegatedServices: ['copilot'],
  },
} as const

/**
 * Controllable mock functions for `@/lib/mothership/chat/organization-chats`: one `execute` per
 * exported use case, named `mock<Export>`. Every fn is a bare `vi.fn()` — organization membership
 * and chat ownership are what callers branch on, so resolve the context (or reject) per test.
 *
 * @example
 * ```ts
 * import { mothershipOrganizationChatsMockFns } from '@sim/testing/mocks/mothership-organization-chats.mock'
 *
 * mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatEvents.mockResolvedValue({
 *   organizationId: 'org-1',
 *   userId: 'user-1',
 *   role: 'member',
 * })
 * ```
 */
export const mothershipOrganizationChatsMockFns = {
  mockAuthorizeOrganizationChat: vi.fn(),
  mockAuthorizeOrganizationChatEvents: vi.fn(),
  mockListOrganizationChats: vi.fn(),
  mockCreateOrganizationChat: vi.fn(),
  mockAuthorizeOrganizationChatCancellation: vi.fn(),
  mockAuthorizeOrganizationChatDelegation: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/chat/organization-chats`. The operation maps carry the
 * real definitions; each use case is `{ operation, execute }` (`authorizeOrganizationChatDelegation`
 * has no `operation`, as in production).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
 * ```
 */
export const mothershipOrganizationChatsMock = {
  organizationChatOperations: ORGANIZATION_CHAT_OPERATIONS,
  organizationChatDelegationOperations: ORGANIZATION_CHAT_DELEGATION_OPERATIONS,
  authorizeOrganizationChat: {
    operation: ORGANIZATION_CHAT_OPERATIONS.read,
    execute: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChat,
  },
  authorizeOrganizationChatEvents: {
    operation: ORGANIZATION_CHAT_OPERATIONS.subscribe,
    execute: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatEvents,
  },
  listOrganizationChats: {
    operation: ORGANIZATION_CHAT_OPERATIONS.list,
    execute: mothershipOrganizationChatsMockFns.mockListOrganizationChats,
  },
  createOrganizationChat: {
    operation: ORGANIZATION_CHAT_OPERATIONS.create,
    execute: mothershipOrganizationChatsMockFns.mockCreateOrganizationChat,
  },
  authorizeOrganizationChatCancellation: {
    operation: ORGANIZATION_CHAT_DELEGATION_OPERATIONS.cancel,
    execute: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatCancellation,
  },
  authorizeOrganizationChatDelegation: {
    execute: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation,
  },
}
