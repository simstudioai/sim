import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRefusedError, observeContentDelivery } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { fileReadFailure } from '@/lib/mothership/agent-cli/engines/file-view'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery'

const hoisted = vi.hoisted(() => ({
  context: vi.fn(),
  snapshot: vi.fn(),
  receipt: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: hoisted.context,
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: hoisted.snapshot,
}))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: () => ({
    observeUpload: (_machine: unknown, stream: unknown) => stream,
    uploadProvenance: hoisted.receipt,
  }),
}))

import {
  normalizeScratchPath,
  readChatSandboxFile,
} from '@/lib/mothership/chat/application/read-sandbox-file'

const mocks = {
  ...hoisted,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal: Principal = createSessionPrincipal({ userId: 'u', sessionId: 's' })
const chatPrincipal = createCopilotChatFilePrincipal({
  userId: 'u',
  workspaceId: 'ws',
  chatId: 'chat',
})

/** Chat's reads run under the gate its transport installs; no registry, so secrets are refused. */
function readAsChat(scope: { principal?: Principal } = {}) {
  return observeContentDelivery(
    createRegistryContentGate({ workspaceId: 'ws', actorUserId: 'u' }),
    () => readChatSandboxFile.execute({ principal: scope.principal ?? chatPrincipal, input })
  )
}
const input = { workspaceId: 'ws', chatId: 'chat', path: '/tmp/image.png' }
const machine = { providerId: 'e2b', sandboxId: 'physical' }
beforeEach(() => {
  mocks.permission.mockResolvedValue('read')
  mocks.context.mockResolvedValue({
    workspaceId: 'ws',
    chatId: 'chat',
    userId: 'u',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'owner',
  })
  mocks.receipt.mockReturnValue({ status: 'exact', entries: [] })
  mocks.snapshot.mockImplementation(async (_key, _path, _signal, observer) => ({
    size: 3,
    dispose: hoisted.dispose,
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
      hasRecordedSecrets: false,
    })
    expect(mocks.context).toHaveBeenCalledWith(principal, 'chat')
    expect(mocks.snapshot).toHaveBeenCalledWith(
      'mothership-chat:chat',
      input.path,
      undefined,
      expect.any(Function),
      { allowedRoots: ['/home/user', '/tmp'], maxBytes: 25 * 1024 * 1024 }
    )
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
    'refuses Chat explicit unknown or unredactable secret-bearing provenance: %j',
    async (receipt) => {
      mocks.receipt.mockReturnValue(receipt)
      await expect(readAsChat()).rejects.toBeInstanceOf(ContentRefusedError)
      expect(mocks.dispose).toHaveBeenCalledOnce()
    }
  )
  it('serves the user their own scratch file whatever its provenance, flagging recorded secrets', async () => {
    mocks.receipt.mockReturnValue({
      status: 'exact',
      entries: [{ encryptedValue: 'secret', sourceUserId: 'u' }],
    })
    expect(await readChatSandboxFile.execute({ principal, input })).toMatchObject({
      name: 'image.png',
      hasRecordedSecrets: true,
    })
  })
  it('passes a classified workbench failure through to the model unchanged', async () => {
    const missing = new OrchestrationError('not_found', 'No file exists at /tmp/image.png')
    mocks.snapshot.mockRejectedValue(missing)
    const failure = await readAsChat().catch((error: unknown) => error)
    expect(failure).toBe(missing)
    expect(fileReadFailure(failure).stderr).toBe('Error: No file exists at /tmp/image.png')
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
    expect((await readAsChat()).name).toBe('image.png')
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

it('accepts the verified personal API principal through the same canonical chat authorization', async () => {
  const personal = createPersonalApiKeyPrincipal({ userId: 'u', keyId: 'verified-key' })
  expect((await readChatSandboxFile.execute({ principal: personal, input })).name).toBe('image.png')
  expect(mocks.context).toHaveBeenCalledWith(personal, 'chat')
})
it('rejects a workspace API key before canonical lookup or sandbox access', async () => {
  await expect(
    Reflect.apply(readChatSandboxFile.execute, null, [
      { principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws', keyId: 'key' }), input },
    ])
  ).rejects.toThrow()
  expect(mocks.context).not.toHaveBeenCalled()
  expect(mocks.snapshot).not.toHaveBeenCalled()
})

it('permits Chat a source explicitly classified as unrecorded', async () => {
  mocks.receipt.mockReturnValue({ status: 'unrecorded' })
  expect((await readAsChat()).buffer).toEqual(Buffer.from('png'))
})
