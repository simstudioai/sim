/** @vitest-environment node */
import type { EmbeddedCliIdentity } from 'sim/embed'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ target: vi.fn(), transport: vi.fn(), file: vi.fn() }))
vi.mock('@/lib/mothership/application/workspace-target', () => ({
  resolveInvocationWorkspace: mocks.target,
}))
vi.mock('@/lib/mothership/agent-cli/scoped-transport', () => ({
  createScopedCliTransport: () => mocks.transport,
}))
vi.mock('@/lib/mothership/agent-cli/workbench-file-provenance', () => ({
  createWorkbenchFileProvenance: () => ({ observeOutput: vi.fn() }),
}))
vi.mock('@/lib/mothership/agent-cli/file-upload-transport', () => ({
  createFileUploadTransport: ({ fallback }: { fallback: typeof fetch }) => fallback,
}))
vi.mock('@/lib/mothership/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: mocks.file,
}))
vi.mock('@/lib/mothership/agent-cli/run-cli', () => ({
  async runCli(_argv: string[], identity: EmbeddedCliIdentity) {
    const response = await identity.transport!(
      `${identity.endpoint}/api/v2/files/uploads/upload/complete?workspaceId=${identity.workspaceId}`,
      { method: 'POST' }
    )
    return { exitCode: 0, stdout: await response.text(), stderr: '' }
  },
}))

import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { getChatResourceKey } from '@/lib/mothership/resources/types'
import { openResourceServerTool } from '@/lib/mothership/tools/server/open-resource'

const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
const fileId = 'wf_uploaded_file'
const file = {
  id: fileId,
  name: 'upload-acceptance.txt',
  webUrl: `https://sim.test/files/${fileId}`,
  size: 59,
  type: 'text/plain',
  key: 'workspace/upload-acceptance.txt',
  folderPath: '/',
  uploadedByEmail: 'fixture@example.com',
  uploadedAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  deletedAt: null,
}
const context = {
  userId: 'actor',
  workspaceId: first,
  chatId: 'chat',
  toolCallId: 'call',
  requestMode: 'agent',
  copilotToolExecution: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.target.mockImplementation(async (_context, target) => ({
    workspaceId: target ?? first,
    userId: 'actor',
    permission: 'write',
  }))
  mocks.file.mockResolvedValue({ file })
  mocks.transport.mockImplementation(async () =>
    Response.json({
      data: {
        id: 'upload',
        status: 'completed',
        name: file.name,
        contentType: file.type,
        size: file.size,
        expiresAt: '2099-01-01T00:00:00.000Z',
        error: null,
        file,
      },
    })
  )
})

describe('scoped CLI resource ownership', () => {
  it('gives a workspace upload completion and explicit open the same resource identity', async () => {
    const upload = await executeAgentCliRequest(
      { invocation: { kind: 'cli', argv: ['files', 'upload', '@/tmp/upload-acceptance.txt'] } },
      context
    )
    const opened = await openResourceServerTool.execute(
      { resources: [{ type: 'file', id: fileId }] },
      context
    )
    const effect = upload.resources?.[0]
    if (effect?.op !== 'upsert') throw new Error('Upload completion must publish a file')
    const resource = effect.resource
    expect(resource).toEqual({
      type: 'file',
      id: fileId,
      title: file.name,
      path: 'files/upload-acceptance.txt',
      workspaceId: first,
    })
    expect(getChatResourceKey(resource)).toBe(getChatResourceKey(opened.resources[0]))
    expect(mocks.transport).toHaveBeenCalledTimes(1)
  })

  it('keeps organization targets distinct even when a resource ID is reused', async () => {
    const keys: string[] = []
    for (const workspaceId of [first, second]) {
      const result = await executeAgentCliRequest(
        {
          workspaceId,
          invocation: { kind: 'cli', argv: ['files', 'upload', '@/tmp/upload-acceptance.txt'] },
        },
        { ...context, workspaceId: undefined, organizationId: 'org' }
      )
      const effect = result.resources?.[0]
      if (effect?.op !== 'upsert') throw new Error('Upload completion must publish a file')
      expect(effect.resource.workspaceId).toBe(workspaceId)
      keys.push(getChatResourceKey(effect.resource))
    }
    expect(new Set(keys).size).toBe(2)
  })
})
