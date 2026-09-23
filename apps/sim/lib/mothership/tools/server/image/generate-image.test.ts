/**
 * @vitest-environment node
 *
 * Reference images are declared inputs. A path that does not load must fail the
 * call rather than let the model render from whatever remained: the user who
 * attached a face and got a "v4" without it, and without an error, is the defect
 * these assertions pin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateContent,
  mockIsOpaqueWorkspaceFileEgressSafe,
  mockResolveWorkspaceFileReference,
  mockReadWorkspaceFileContent,
  mockWriteWorkspaceFileByPath,
} = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockIsOpaqueWorkspaceFileEgressSafe: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockReadWorkspaceFileContent: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mockGenerateContent }
  },
}))
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: vi.fn(() => 'api-key') }))
vi.mock('@/lib/mothership/vfs/resource-writer', () => ({
  writeCopilotWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', async () => {
  /** The Copilot adapter admits a use case only by its registered operation object. */
  const { fileOperations } = await import('@/lib/workspace-files/application/operations')
  return {
    readWorkspaceFileContent: {
      operation: fileOperations.readContent,
      execute: mockReadWorkspaceFileContent,
    },
  }
})
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  createWorkspaceFileSecretProvenanceFromRegistry: vi.fn(async () => ({
    safe: true,
    provenance: { status: 'exact', entries: [] },
  })),
  isOpaqueWorkspaceFileEgressSafe: mockIsOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const WORKSPACE_ID = 'workspace-1'

const chatUpload = {
  id: 'wf_upload',
  workspaceId: WORKSPACE_ID,
  name: 'face.png',
  key: `workspace/${WORKSPACE_ID}/1731000000000-ab12cd34-face.png`,
  path: '/api/files/serve/face.png?context=mothership',
  size: 10,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  storageContext: 'mothership' as const,
  vfsNamespace: 'uploads' as const,
}

const workspaceFile = {
  ...chatUpload,
  id: 'wf_base',
  name: 'base.png',
  key: `workspace/${WORKSPACE_ID}/1731000000001-ab12cd35-base.png`,
  storageContext: 'workspace' as const,
  vfsNamespace: undefined,
}

function context(): ServerToolContext {
  return {
    userId: 'user-1',
    workspaceId: WORKSPACE_ID,
    toolCallId: 'tool-1',
    copilotToolExecution: true,
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([]),
  }
}

function generate(paths: string[]) {
  return generateImageServerTool.execute(
    { prompt: 'add this face to it', inputs: { files: paths.map((path) => ({ path })) } },
    context()
  )
}

describe('generate_image reference images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(true)
    mockResolveWorkspaceFileReference.mockResolvedValue(chatUpload)
    mockReadWorkspaceFileContent.mockResolvedValue({
      file: chatUpload,
      content: Buffer.from('face-bytes'),
    })
    mockWriteWorkspaceFileByPath.mockResolvedValue({
      id: 'wf_out',
      name: 'generated-image.png',
      size: 5,
      contentType: 'image/png',
      vfsPath: 'files/generated-image.png',
      mode: 'create',
      downloadUrl: '/api/files/serve/out.png',
    })
    mockGenerateContent.mockResolvedValue({
      candidates: [
        { content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } },
      ],
    })
  })

  it('loads a chat upload reference through the read-content reference resolver', async () => {
    const result = await generate(['uploads/face.png'])

    expect(result.success).toBe(true)
    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: fileOperations.readContent,
        workspaceId: WORKSPACE_ID,
        reference: 'uploads/face.png',
      })
    )
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            parts: expect.arrayContaining([
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from('face-bytes').toString('base64'),
                },
              },
            ]),
          }),
        ],
      })
    )
  })

  it('fails the call, naming the path, when a reference image does not resolve', async () => {
    mockResolveWorkspaceFileReference.mockRejectedValue(
      new OrchestrationError('not_found', 'File not found')
    )

    const result = await generate(['uploads/image.png'])

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Reference image "uploads/image.png" was not found'),
      })
    )
    expect(mockReadWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('never renders from a subset of the declared references', async () => {
    mockResolveWorkspaceFileReference
      .mockResolvedValueOnce(workspaceFile)
      .mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))

    const result = await generate(['files/base.png', 'uploads/face.png'])

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('"uploads/face.png"'),
      })
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('fails the call, naming the path, when a reference image cannot be read', async () => {
    mockReadWorkspaceFileContent.mockRejectedValue(new Error('storage unavailable'))

    const result = await generate(['uploads/face.png'])

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining(
          'Reference image "uploads/face.png" could not be read: storage unavailable'
        ),
      })
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('still refuses a model-unsafe reference with the safety message', async () => {
    mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(false)

    const result = await generate(['uploads/face.png'])

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('cannot be sent'),
      })
    )
    expect(mockReadWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })
})
