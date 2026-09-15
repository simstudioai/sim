/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  context: vi.fn(),
  snapshot: vi.fn(),
  clean: vi.fn(),
  receipt: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (role: string | null) => role !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedWorkspaceChatContext: mocks.context,
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-provenance', () => ({
  isSessionFileProvenanceClean: mocks.clean,
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: mocks.snapshot,
}))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: () => ({
    observeUpload: (_machine: unknown, stream: unknown) => stream,
    uploadProvenance: mocks.receipt,
  }),
}))

import {
  normalizeScratchPath,
  readChatSandboxFile,
} from '@/lib/mothership/chat/application/read-sandbox-file'

const principal: Principal = { kind: 'session', userId: 'u', sessionId: 's' }
const input = { workspaceId: 'ws', chatId: 'chat', path: '/tmp/image.png' }
const machine = { providerId: 'e2b', sandboxId: 'physical' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue('read')
  mocks.context.mockResolvedValue({
    workspaceId: 'ws',
    chatId: 'chat',
    userId: 'u',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'owner',
  })
  mocks.clean.mockResolvedValue(true)
  mocks.receipt.mockReturnValue({ status: 'unknown' })
  mocks.snapshot.mockImplementation(async (_key, _path, _signal, observer) => ({
    size: 3,
    dispose: mocks.dispose,
    stream: async () =>
      observer(
        machine,
        new ReadableStream({
          start(c) {
            c.enqueue(Buffer.from('png'))
            c.close()
          },
        })
      ),
  }))
})
describe('owned scratch snapshot reads', () => {
  it('uses canonical chat identity, bounds physical paths, returns bytes without creating resources', async () => {
    expect(await readChatSandboxFile.execute({ principal, input })).toEqual({
      buffer: Buffer.from('png'),
      name: 'image.png',
      path: input.path,
    })
    expect(mocks.context).toHaveBeenCalledWith(principal, 'chat')
    expect(mocks.snapshot).toHaveBeenCalledWith(
      'mothership-chat:chat',
      input.path,
      undefined,
      expect.any(Function),
      { allowedRoots: ['/home/user', '/tmp'], maxBytes: 25 * 1024 * 1024 }
    )
    expect(mocks.clean).toHaveBeenCalledWith('mothership-chat:chat', machine)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it.each(['permission', 'foreign-workspace', 'foreign-chat'])(
    'refuses %s before touching a sandbox',
    async (kind) => {
      if (kind === 'permission') mocks.permission.mockResolvedValue(null)
      if (kind === 'foreign-workspace') mocks.context.mockResolvedValue({ workspaceId: 'other' })
      if (kind === 'foreign-chat') mocks.context.mockRejectedValue(new Error('Chat not found'))
      await expect(readChatSandboxFile.execute({ principal, input })).rejects.toThrow()
      expect(mocks.snapshot).not.toHaveBeenCalled()
    }
  )
  it.each([
    { status: 'unknown' },
    { status: 'exact', entries: [{ encryptedValue: 'secret', sourceUserId: 'u' }] },
  ])(
    'refuses unknown or secret prior machine inputs even without a current registry: %j',
    async (receipt) => {
      mocks.clean.mockResolvedValue(false)
      mocks.receipt.mockReturnValue(receipt)
      await expect(readChatSandboxFile.execute({ principal, input })).rejects.toThrow(
        'no verified secret-free provenance'
      )
      expect(mocks.dispose).toHaveBeenCalledOnce()
    }
  )
  it('permits an unchanged exact-empty digest receipt after other machine inputs became unknown', async () => {
    mocks.clean.mockResolvedValue(false)
    mocks.receipt.mockReturnValue({ status: 'exact', entries: [] })
    expect((await readChatSandboxFile.execute({ principal, input })).buffer).toEqual(
      Buffer.from('png')
    )
    expect(mocks.clean).not.toHaveBeenCalled()
  })
  it('enforces size before streaming and still disposes the snapshot', async () => {
    await expect(
      readChatSandboxFile.execute({ principal, input: { ...input, maxBytes: 2 } })
    ).rejects.toThrow('byte limit')
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it.each([
    '/etc/passwd',
    '/tmp/../../etc/passwd',
    '/home/user/../../../etc/passwd',
    '/tmpx/file',
    'https://example.com/a.png',
    'files/a.png',
    '/tmp/a\0b',
  ])('rejects non-scratch path %s', (path) => {
    expect(() => normalizeScratchPath(path)).toThrow()
  })
  it('normalizes paths within permitted roots', () => {
    expect(normalizeScratchPath('/tmp/a/../b.png')).toBe('/tmp/b.png')
  })
})

describe('scoped chat file delegation', () => {
  it('accepts the canonical owned chat principal without minting an API key', async () => {
    const delegated = createCopilotChatFilePrincipal({
      userId: 'u',
      workspaceId: 'ws',
      chatId: 'chat',
    })
    expect((await readChatSandboxFile.execute({ principal: delegated, input })).name).toBe(
      'image.png'
    )
  })
  it.each(['chat', 'audience', 'expired', 'file'])(
    'denies wrong %s delegation before sandbox access',
    async (kind) => {
      const valid = createCopilotChatFilePrincipal({
        userId: 'u',
        workspaceId: 'ws',
        chatId: 'chat',
      })
      const delegated = {
        ...valid,
        ...(kind === 'chat' ? { resourceScope: { chatId: 'other' } } : {}),
        ...(kind === 'audience' ? { audience: 'other' } : {}),
        ...(kind === 'expired' ? { expiresAt: new Date(0) } : {}),
        ...(kind === 'file' ? { resourceScope: { chatId: 'chat', fileId: 'specific-file' } } : {}),
      }
      await expect(readChatSandboxFile.execute({ principal: delegated, input })).rejects.toThrow()
      expect(mocks.snapshot).not.toHaveBeenCalled()
    }
  )
})

it('never lets a broad clean marker override an exact secret-bearing file receipt', async () => {
  mocks.clean.mockResolvedValue(true)
  mocks.receipt.mockReturnValue({
    status: 'exact',
    entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'u' }],
  })
  await expect(readChatSandboxFile.execute({ principal, input })).rejects.toThrow(
    'no verified secret-free provenance'
  )
})

it('accepts the verified personal API principal through the same canonical chat authorization', async () => {
  const personal = { kind: 'personal_api_key' as const, userId: 'u', keyId: 'verified-key' }
  expect((await readChatSandboxFile.execute({ principal: personal, input })).name).toBe('image.png')
  expect(mocks.context).toHaveBeenCalledWith(personal, 'chat')
})
it('rejects a workspace API key before canonical lookup or sandbox access', async () => {
  await expect(
    Reflect.apply(readChatSandboxFile.execute, null, [
      { principal: { kind: 'workspace_api_key', workspaceId: 'ws', keyId: 'key' }, input },
    ])
  ).rejects.toThrow()
  expect(mocks.context).not.toHaveBeenCalled()
  expect(mocks.snapshot).not.toHaveBeenCalled()
})
