import type { Principal } from '@sim/auth/principal'
import { copilotChats, member } from '@sim/db/schema'
import { authMockFns, databaseMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  scratch: vi.fn(),
  artifact: vi.fn(),
  target: vi.fn(),
  fileContext: vi.fn(),
}))
vi.mock('@/lib/mothership/application/workspace-target', () => ({
  resolveInvocationWorkspace: mocks.target,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.fileContext,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))
vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (role: string | null) => role !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: vi.fn(async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
  })),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mocks.upload,
  downloadFile: mocks.download,
}))
vi.mock('@/lib/mothership/chat/application/read-sandbox-file', () => ({
  readChatSandboxFile: { execute: mocks.scratch },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-artifact', () => ({
  readWorkspaceFileArtifact: { execute: mocks.artifact },
}))
vi.mock('@/lib/execution/remote-sandbox', () => ({ executeInSandbox: vi.fn() }))

import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import {
  materializeInlineChatImage,
  materializeStreamImage,
  readInlineChatImage,
} from '@/lib/mothership/chat/application/inline-images'
import { inlineChatImageUrl } from '@/lib/mothership/chat/inline-image-reference'
import { inlineChatImageKey } from '@/lib/mothership/chat/inline-image-storage'
import { GET } from '@/app/api/mothership/chats/[chatId]/images/[requestId]/route'

const principal: Principal = { kind: 'session', userId: 'owner', sessionId: 'session' }
const input = { chatId: 'chat', requestId: 'request', reference: 'files/chart.png' }
const owner = {
  userId: 'owner',
  workspaceId: 'workspace',
  organizationId: null,
  type: 'mothership',
}
function ownChat() {
  queueTableRows(copilotChats, [owner])
}
const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
async function raster() {
  return sharp({ create: { width: 4, height: 3, channels: 3, background: '#ee2244' } })
    .png()
    .toBuffer()
}
beforeEach(() => {
  resetDbChainMock()
  mocks.permission.mockResolvedValue('read')
  mocks.upload.mockResolvedValue({})
  mocks.download.mockRejectedValue(missing())
  authMockFns.mockGetSession.mockResolvedValue({
    session: { id: 'session' },
    user: { id: 'owner' },
  })
})
describe('private chat image application boundary', () => {
  it.each([
    '/tmp/chart.png',
    '/home/user/chart.png',
    'files/chart.png',
    'uploads/chart.png',
    '11111111-1111-4111-8111-111111111111',
  ])(
    'snapshots %s through its authorized source with no metadata/resource writes',
    async (reference) => {
      ownChat()
      const buffer = await raster()
      mocks.scratch.mockResolvedValue({ buffer })
      mocks.artifact.mockResolvedValue({ buffer })
      const result = await materializeInlineChatImage.execute({
        principal,
        input: { ...input, reference },
      })
      expect(result).toEqual({ url: inlineChatImageUrl('chat', 'request', reference) })
      expect(mocks.scratch).toHaveBeenCalledTimes(reference.startsWith('/') ? 1 : 0)
      expect(mocks.artifact).toHaveBeenCalledTimes(reference.startsWith('/') ? 0 : 1)
      const upload = mocks.upload.mock.calls[0][0]
      expect(upload).toMatchObject({
        customKey: inlineChatImageKey('chat', 'request', reference),
        context: 'mothership',
        persistMetadata: false,
        createOnly: true,
        contentType: 'image/webp',
      })
      expect(upload).not.toHaveProperty('metadata')
      expect(await sharp(upload.file).metadata()).toMatchObject({
        format: 'webp',
        width: 4,
        height: 3,
      })
    }
  )
  it('reuses the first snapshot after source expiry/replay without source reads or another write', async () => {
    ownChat()
    mocks.download.mockResolvedValue(await raster())
    await expect(materializeInlineChatImage.execute({ principal, input })).resolves.toEqual({
      url: inlineChatImageUrl('chat', 'request', input.reference),
    })
    expect(mocks.artifact).not.toHaveBeenCalled()
    expect(mocks.scratch).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it.each(['foreign-owner', 'deleted-chat', 'revoked-membership'])(
    'denies %s before storage or source access',
    async (reason) => {
      queueTableRows(
        copilotChats,
        reason === 'deleted-chat'
          ? []
          : [{ ...owner, userId: reason === 'foreign-owner' ? 'other' : 'owner' }]
      )
      if (reason === 'revoked-membership') mocks.permission.mockResolvedValue(null)
      await expect(materializeInlineChatImage.execute({ principal, input })).rejects.toThrow()
      expect(mocks.download).not.toHaveBeenCalled()
      expect(mocks.upload).not.toHaveBeenCalled()
    }
  )
  it('does not resolve the same reference from another chat', async () => {
    ownChat()
    await expect(
      readInlineChatImage.execute({ principal, input: { ...input, chatId: 'other-chat' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ key: inlineChatImageKey('other-chat', 'request', input.reference) })
    )
    expect(mocks.artifact).not.toHaveBeenCalled()
  })
  it.each(['wrong-chat', 'wrong-audience', 'expired'])(
    'denies %s delegated authority before bytes',
    async (kind) => {
      ownChat()
      const delegated = createCopilotChatFilePrincipal({
        userId: 'owner',
        workspaceId: 'workspace',
        chatId: 'chat',
      })
      const invalid = {
        ...delegated,
        ...(kind === 'wrong-chat'
          ? { resourceScope: { chatId: 'other' } }
          : kind === 'wrong-audience'
            ? { audience: 'other' }
            : { expiresAt: new Date(0) }),
      }
      await expect(
        materializeInlineChatImage.execute({ principal: invalid, input })
      ).rejects.toThrow()
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )
  it('accepts the existing chat-scoped Copilot file delegation', async () => {
    ownChat()
    mocks.artifact.mockResolvedValue({ buffer: await raster() })
    await materializeStreamImage(
      { userId: 'owner', workspaceId: 'workspace', chatId: 'chat' },
      input
    )
    expect(mocks.artifact.mock.calls[0][0].principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'copilot',
      audience: 'sim:workspace-files',
      resourceScope: { chatId: 'chat' },
    })
  })
  it('refuses decoder failure without upload', async () => {
    ownChat()
    mocks.artifact.mockResolvedValue({ buffer: Buffer.from('broken') })
    await expect(materializeInlineChatImage.execute({ principal, input })).rejects.toThrow()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('refuses provenance failure without upload', async () => {
    ownChat()
    mocks.artifact.mockRejectedValue(new Error('provenance refused'))
    await expect(materializeInlineChatImage.execute({ principal, input })).rejects.toThrow(
      'provenance refused'
    )
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('cancels before any byte access', async () => {
    ownChat()
    const controller = new AbortController()
    controller.abort()
    await expect(
      materializeInlineChatImage.execute({
        principal,
        input: { ...input, signal: controller.signal },
      })
    ).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('does not hide storage infrastructure failures as missing images', async () => {
    ownChat()
    mocks.download.mockRejectedValue(new Error('storage outage'))
    await expect(materializeInlineChatImage.execute({ principal, input })).rejects.toThrow(
      'storage outage'
    )
    expect(mocks.artifact).not.toHaveBeenCalled()
  })
})
describe('image HTTP route', () => {
  const request = () =>
    new NextRequest(`http://localhost${inlineChatImageUrl('chat', 'request', input.reference)}`)
  const params = { params: Promise.resolve({ chatId: 'chat', requestId: 'request' }) }
  it('authenticates before parsing', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await GET(
      new NextRequest('http://localhost/api/mothership/chats/x/images/y'),
      { params: Promise.resolve({ chatId: '/', requestId: '/' }) }
    )
    expect(response.status).toBe(401)
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('only reads immutable image bytes with private/no-store headers', async () => {
    ownChat()
    const buffer = await sharp(await raster())
      .webp()
      .toBuffer()
    mocks.download.mockResolvedValue(buffer)
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(buffer)
    expect(mocks.artifact).not.toHaveBeenCalled()
    expect(mocks.scratch).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('conceals a foreign owner before reading bytes', async () => {
    queueTableRows(copilotChats, [{ ...owner, userId: 'other' }])
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })
})

describe('organization inline images', () => {
  function ownOrgChat() {
    queueTableRows(copilotChats, [{ ...owner, workspaceId: null, organizationId: 'org' }])
    queueTableRows(member, [{ role: 'member' }])
  }
  it('publishes scratch using the org chat delegation with no default workspace', async () => {
    ownOrgChat()
    mocks.scratch.mockResolvedValue({ buffer: await raster() })
    await materializeStreamImage(
      { userId: 'owner', organizationId: 'org', chatId: 'chat' },
      { ...input, reference: '/tmp/chart.png' }
    )
    expect(mocks.scratch).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'organization_delegated',
          organizationId: 'org',
          resourceScope: { chatId: 'chat' },
        }),
        input: expect.objectContaining({ organizationId: 'org', workspaceId: undefined }),
      })
    )
    expect(mocks.target).not.toHaveBeenCalled()
  })
  it('resolves a canonical workspace file ID and authorizes its target before artifact access', async () => {
    ownOrgChat()
    mocks.fileContext.mockResolvedValue({ workspaceId: 'target' })
    mocks.target.mockResolvedValue({ workspaceId: 'target' })
    mocks.artifact.mockResolvedValue({ buffer: await raster() })
    const reference = '11111111-1111-4111-8111-111111111111'
    await materializeInlineChatImage.execute({ principal, input: { ...input, reference } })
    expect(mocks.target).toHaveBeenCalledWith(
      { userId: 'owner', organizationId: 'org', chatId: 'chat' },
      'target'
    )
    expect(mocks.artifact).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ workspaceId: 'target' }),
        input: expect.objectContaining({ workspaceId: 'target', reference }),
      })
    )
  })
  it('does not read a file when its canonical workspace target is denied', async () => {
    ownOrgChat()
    mocks.fileContext.mockResolvedValue({ workspaceId: 'foreign' })
    mocks.target.mockRejectedValue(new Error('Target denied'))
    await expect(
      materializeInlineChatImage.execute({
        principal,
        input: { ...input, reference: '11111111-1111-4111-8111-111111111111' },
      })
    ).rejects.toThrow('Target denied')
    expect(mocks.artifact).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
