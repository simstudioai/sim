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

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readChatAttachment, readWorkspaceFileOrChatUpload } from './read-attachment'

const mockLoadAttachments = mothershipChatLifecycleMockFns.mockLoadChatFileAttachmentsNamed

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
  mockLoadAttachments.mockResolvedValue([file])
  mocks.read.mockResolvedValue({ buffer: Buffer.from('a,b'), name: 'a.csv' })
})
describe('organization chat upload references', () => {
  it.each(['uploads/upload-a', 'uploads/a.csv'])(
    'reads %s only through a saved attachment in the owned chat',
    async (reference) => {
      await readChatAttachment.execute({ principal, input: { chatId: 'chat', reference } })
      expect(mockLoadAttachments).toHaveBeenCalledWith('chat', reference.slice('uploads/'.length))
      expect(mocks.read).toHaveBeenCalledWith({
        principal,
        organizationId: 'org',
        key: file.key,
        maxBytes: undefined,
        signal: undefined,
      })
    }
  )
  it('refuses a reference with no saved attachment before storage', async () => {
    mockLoadAttachments.mockResolvedValue([])
    await expect(
      readChatAttachment.execute({
        principal,
        input: { chatId: 'chat', reference: 'uploads/other-id' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('requires an ID for ambiguous filenames while repeated mentions of one attachment remain readable', async () => {
    mockLoadAttachments
      .mockResolvedValueOnce([file, file, { ...file, id: 'upload-b', key: 'other' }])
      .mockResolvedValueOnce([file, file])
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
    expect(mockLoadAttachments).not.toHaveBeenCalled()
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
    expect(mockLoadAttachments).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
})

describe('a workspace chat’s upload its workspace lacks', () => {
  const read = (reference: string) => ({ principal, input: { chatId: 'chat', reference } })
  const missingFromWorkspace = async () => {
    throw new OrchestrationError('not_found', 'Workspace file not found')
  }

  it('reads the chat’s own attachment, as a chat moved from its organization keeps', async () => {
    expect(
      await readWorkspaceFileOrChatUpload(missingFromWorkspace, read('uploads/a.csv'))
    ).toMatchObject({ attachment: { name: 'a.csv' } })
  })

  it('keeps the workspace’s answer when the chat holds no attachment by that name', async () => {
    mockLoadAttachments.mockResolvedValue([])
    await expect(
      readWorkspaceFileOrChatUpload(missingFromWorkspace, read('uploads/report.csv'))
    ).rejects.toThrow('Workspace file not found')
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('never reaches the chat for a file its workspace holds, or for any other refusal', async () => {
    expect(
      await readWorkspaceFileOrChatUpload(async () => 'workspace-file', read('uploads/a.csv'))
    ).toEqual({ file: 'workspace-file' })
    await expect(
      readWorkspaceFileOrChatUpload(async () => {
        throw new OrchestrationError('forbidden', 'No access')
      }, read('uploads/a.csv'))
    ).rejects.toThrow('No access')
    expect(mockLoadAttachments).not.toHaveBeenCalled()
  })
})
