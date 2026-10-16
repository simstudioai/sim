import { copilotChats } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { authBanMock } from '@sim/testing/mocks/auth-ban.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { remoteSandboxMock } from '@sim/testing/mocks/remote-sandbox.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { workspaceContextMock } from '@sim/testing/mocks/workspace-context.mock'
import sharp from 'sharp'
import { beforeEach, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  snapshot: vi.fn(),
  dispose: vi.fn(),
  provenance: vi.fn(() => ({ status: 'exact', entries: [] as unknown[] })),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/auth/ban', () => authBanMock)
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/workspace-files/application/read-workspace-file-artifact', () => ({
  readWorkspaceFileArtifact: { execute: vi.fn() },
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-provenance', () => ({
  isSessionFileProvenanceClean: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: hoisted.snapshot,
}))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: () => ({
    observeUpload: (_machine: unknown, stream: unknown) => stream,
    uploadProvenance: () => hoisted.provenance(),
  }),
}))
vi.mock('@/lib/execution/remote-sandbox', () => remoteSandboxMock)

import { materializeStreamImage } from '@/lib/mothership/chat/application/inline-images'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file'

const mocks = { ...hoisted, upload: storageServiceMockFns.mockUploadFile }
workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
storageServiceMockFns.mockDownloadFile.mockRejectedValue(
  Object.assign(new Error('missing'), { code: 'ENOENT' })
)

beforeEach(() => {
  resetDbChainMock()
})
it('runs the real nested scratch authorization, limit validation, snapshot read and image publication', async () => {
  const owner = {
    userId: 'owner',
    workspaceId: 'workspace',
    organizationId: null,
    type: 'mothership',
  }
  queueTableRows(copilotChats, [owner])
  queueTableRows(copilotChats, [owner])
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#5588aa' },
  })
    .png()
    .toBuffer()
  mocks.snapshot.mockResolvedValue({
    size: buffer.length,
    dispose: mocks.dispose,
    stream: async () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(buffer)
          controller.close()
        },
      }),
  })
  await materializeStreamImage(
    { userId: 'owner', workspaceId: 'workspace', chatId: 'chat' },
    { requestId: 'request', reference: '/tmp/my%20chart.png' }
  )
  expect(mocks.snapshot).toHaveBeenCalledWith(
    'mothership-chat:chat',
    '/tmp/my chart.png',
    undefined,
    expect.any(Function),
    { allowedRoots: ['/home/user', '/tmp'], maxBytes: MAX_TEXT_EXTRACTION_BYTES }
  )
  expect(mocks.dispose).toHaveBeenCalledOnce()
  expect(mocks.upload).toHaveBeenCalledWith(
    expect.objectContaining({ createOnly: true, persistMetadata: false, contentType: 'image/webp' })
  )
})

it('refuses an image holding recorded secrets as opaque, naming it without its path', async () => {
  const owner = {
    userId: 'owner',
    workspaceId: 'workspace',
    organizationId: null,
    type: 'mothership',
  }
  queueTableRows(copilotChats, [owner])
  queueTableRows(copilotChats, [owner])
  hoisted.provenance.mockReturnValueOnce({
    status: 'exact',
    entries: [
      {
        encryptedValue: 'ciphertext',
        sourceUserId: 'owner',
        sourceWorkspaceId: 'workspace',
        name: 'FIXTURE_TOKEN',
      },
    ],
  })
  const buffer = Buffer.from('not shown')
  mocks.snapshot.mockResolvedValue({
    size: buffer.length,
    dispose: mocks.dispose,
    stream: async () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(buffer)
          controller.close()
        },
      }),
  })
  const refusals = getMockLogger('DurableSecretProvenancePersistence').warn
  refusals.mockClear()
  await expect(
    materializeStreamImage(
      { userId: 'owner', workspaceId: 'workspace', chatId: 'chat' },
      { requestId: 'request-secret', reference: '/tmp/quarterly%20payroll.png' }
    )
  ).rejects.toThrow()
  expect(refusals).toHaveBeenCalledTimes(1)
  const [, fields] = refusals.mock.calls[0]
  expect(fields).toMatchObject({
    surface: 'workspace-file',
    cause: 'workspace-file-opaque-secret-content',
    parentId: 'chat',
  })
  expect(JSON.stringify(fields)).not.toMatch(/payroll|\/tmp/)
})
