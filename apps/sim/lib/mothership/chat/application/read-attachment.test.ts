import {
  mothershipChatLifecycleMock,
  mothershipChatLifecycleMockFns,
} from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mocks.context,
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)
vi.mock('@/lib/uploads/contexts/organization-assistant/application', () => ({
  readOrganizationChatAttachment: mocks.read,
}))

import { readChatAttachment } from './read-attachment'

const mockLoadCopilotChatMessages = mothershipChatLifecycleMockFns.mockLoadCopilotChatMessages

const principal = { kind: 'session', userId: 'user', sessionId: 'session' } as const
const file = {
  id: 'upload-a',
  key: 'assistant/org/user/upload-a/a.csv',
  filename: 'a.csv',
  media_type: 'text/csv',
  size: 4,
}
beforeEach(() => {
  mocks.context.mockResolvedValue({ organizationId: 'org', chatId: 'chat', userId: 'user' })
  organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockResolvedValue({
    organizationId: 'org',
    userId: 'user',
    role: 'member',
  })
  mockLoadCopilotChatMessages.mockResolvedValue([{ fileAttachments: [file] }])
  mocks.read.mockResolvedValue({ buffer: Buffer.from('a,b'), name: 'a.csv' })
})
describe('organization chat upload references', () => {
  it.each(['uploads/upload-a', 'uploads/a.csv'])(
    'reads %s only through a saved attachment in the owned chat',
    async (reference) => {
      await readChatAttachment.execute({ principal, input: { chatId: 'chat', reference } })
      expect(mockLoadCopilotChatMessages).toHaveBeenCalledWith('chat')
      expect(mocks.read).toHaveBeenCalledWith({
        principal,
        organizationId: 'org',
        key: file.key,
        maxBytes: undefined,
        signal: undefined,
      })
    }
  )
  it('refuses a file from another chat before storage', async () => {
    await expect(
      readChatAttachment.execute({
        principal,
        input: { chatId: 'chat', reference: 'uploads/other-id' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('requires an ID for ambiguous filenames while repeated mentions of one attachment remain readable', async () => {
    mockLoadCopilotChatMessages.mockResolvedValue([
      { fileAttachments: [file, file, { ...file, id: 'upload-b', key: 'other' }] },
    ])
    await expect(
      readChatAttachment.execute({
        principal,
        input: { chatId: 'chat', reference: 'uploads/a.csv' },
      })
    ).rejects.toThrow('Several attachments')
    await readChatAttachment.execute({
      principal,
      input: { chatId: 'chat', reference: 'uploads/upload-a' },
    })
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('rejects a delegation for another chat before reading its transcript', async () => {
    const delegated = createTrustedOrganizationCopilotPrincipal(
      { userId: 'user', organizationId: 'org', chatId: 'other', delegationId: 'test' },
      { audience: 'sim:workspace-files', ttlMs: 60_000 }
    )
    await expect(
      readChatAttachment.execute({
        principal: delegated,
        input: { chatId: 'chat', reference: 'uploads/a.csv' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockLoadCopilotChatMessages).not.toHaveBeenCalled()
  })
  it('propagates revoked membership before transcript or byte access', async () => {
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockRejectedValue(
      new Error('membership revoked')
    )
    await expect(
      readChatAttachment.execute({
        principal,
        input: { chatId: 'chat', reference: 'uploads/a.csv' },
      })
    ).rejects.toThrow('membership revoked')
    expect(mockLoadCopilotChatMessages).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
