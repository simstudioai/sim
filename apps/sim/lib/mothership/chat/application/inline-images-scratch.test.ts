/** @vitest-environment node */
import { copilotChats } from '@sim/db/schema'
import { databaseMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import sharp from 'sharp'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), snapshot: vi.fn(), dispose: vi.fn() }))
vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: vi.fn().mockResolvedValue('read'),
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
  downloadFile: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-artifact', () => ({
  readWorkspaceFileArtifact: { execute: vi.fn() },
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-provenance', () => ({
  isSessionFileProvenanceClean: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: mocks.snapshot,
}))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: () => ({
    observeUpload: (_machine: unknown, stream: unknown) => stream,
    uploadProvenance: () => ({ status: 'exact', entries: [] }),
  }),
}))
vi.mock('@/lib/execution/remote-sandbox', () => ({ executeInSandbox: vi.fn() }))

import { materializeStreamImage } from '@/lib/mothership/chat/application/inline-images'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'

beforeEach(() => {
  vi.clearAllMocks()
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
