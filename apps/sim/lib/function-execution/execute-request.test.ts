/**
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createMockRequest,
  envFlagsMock,
  hybridAuthMockFns,
  resetEnvFlagsMock,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { functionExecuteBodySchema } from '@/lib/api/contracts'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { INTERNAL_EXECUTION_DEADLINE_HEADER } from '@/lib/execution/execution-deadline-header'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
} from '@/lib/execution/private-tool-metadata'
import {
  attachTrustedSandboxOutputCost,
  MAX_SANDBOX_OUTPUT_BYTES,
  SandboxOutputFileError,
  SandboxOutputLimitError,
} from '@/lib/execution/remote-sandbox/output-limits'

const {
  mockExecuteInSandbox,
  mockExecuteInIsolatedVM,
  mockExecuteShellInSandbox,
  mockFetchWorkspaceFileBuffer,
  mockDecryptSecret,
  mockEncryptSecret,
  mockGetWorkspaceFile,
  mockResolveWorkspaceFileReference,
  mockUpdateWorkspaceFileContent,
  mockUploadFile,
  mockValidateWorkspaceFileWriteTarget,
  mockWriteWorkspaceFileByPath,
} = vi.hoisted(() => ({
  mockExecuteInSandbox: vi.fn(),
  mockExecuteInIsolatedVM: vi.fn(),
  mockExecuteShellInSandbox: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockDecryptSecret: vi.fn(async (value: string) => ({
    decrypted: value === 'encrypted:mounted-secret' ? 'mounted-secret' : value,
  })),
  mockEncryptSecret: vi.fn(async (value: string) => ({
    encrypted: `encrypted:${value}`,
    iv: 'iv',
  })),
  mockGetWorkspaceFile: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
  mockUploadFile: vi.fn(),
  mockValidateWorkspaceFileWriteTarget: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: mockEncryptSecret,
}))

vi.mock('@/lib/execution/isolated-vm', () => ({
  executeInIsolatedVM: mockExecuteInIsolatedVM,
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  executeInSandbox: mockExecuteInSandbox,
  executeShellInSandbox: mockExecuteShellInSandbox,
  SIM_RESULT_PREFIX: '__SIM_RESULT__=',
}))

vi.mock('@/lib/copilot/request/tools/files', () => ({
  FORMAT_TO_CONTENT_TYPE: {
    json: 'application/json',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
  },
  normalizeOutputWorkspaceFileName: vi.fn((p: string) => {
    const normalized = p.trim().replace(/^\/+|\/+$/g, '')
    if (!normalized) throw new Error('Output path must include a file name')
    return normalized.replace(/^files\//, '')
  }),
  resolveOutputFormat: vi.fn(() => 'json'),
  getOutputFileDeclarations: vi.fn((params: Record<string, any>) => {
    if (Array.isArray(params.outputs?.files)) {
      return params.outputs.files.map((file: Record<string, any>) => ({
        path: file.path,
        mode: file.mode === 'overwrite' ? 'overwrite' : 'create',
        sandboxPath: file.sandboxPath,
        mimeType: file.mimeType,
        format: file.format,
      }))
    }
    return params.outputPath
      ? [
          {
            path: params.overwriteFileId || params.outputPath,
            mode: params.overwriteFileId ? 'overwrite' : 'create',
            sandboxPath: params.outputSandboxPath,
            mimeType: params.outputMimeType,
            format: params.outputFormat,
            formatPath: params.outputPath,
            overwriteFileId: params.overwriteFileId,
          },
        ]
      : []
  }),
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  validateWorkspaceFileWriteTarget: mockValidateWorkspaceFileWriteTarget,
  writeWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
  getWorkspaceFile: mockGetWorkspaceFile,
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
  updateWorkspaceFileContent: mockUpdateWorkspaceFileContent,
  uploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: {
    execute: vi.fn(async () => ({ content: await mockFetchWorkspaceFileBuffer() })),
  },
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

/**
 * Only the I/O half is stubbed. Path naming, transports, ceilings and
 * authorization are covered against the real implementation in
 * `sandbox-mounts.test.ts`; what matters here is the wiring — that a marker
 * becomes a mount and that the context variable ends up holding the path.
 */
vi.mock('@/lib/function-execution/sandbox-mounts', () => ({
  planUserFileMounts: (files: Array<{ key: string; name: string }>) =>
    files.map((userFile) => ({ userFile, mountPath: `/tmp/sim/inputs/${userFile.name}` })),
  resolveUserFileMounts: async ({
    planned,
  }: {
    planned: Array<{ userFile: { name: string }; mountPath: string }>
  }) => ({
    sandboxFiles: planned.map(({ mountPath }) => ({
      type: 'url' as const,
      path: mountPath,
      url: 'https://presigned.example/object',
    })),
    manifest: planned.map(({ userFile, mountPath }) => ({
      name: userFile.name,
      path: mountPath,
      size: 1,
      type: 'application/pdf',
    })),
  }),
}))

import { validateProxyUrl } from '@/lib/core/security/input-validation'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { executeFunctionRequest } from '@/lib/function-execution/execute-request'

async function POST(request: NextRequest): Promise<Response> {
  const auth = await hybridAuthMockFns.mockCheckInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return Response.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const parsed = functionExecuteBodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  return executeFunctionRequest({ headers: request.headers, signal: request.signal }, parsed.data, {
    attributedUserId: auth.userId,
    principal: {
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: auth.userId,
      workspaceId: parsed.data.workspaceId ?? 'workspace-test',
      delegationId: 'function-test',
      audience: 'sim:function-executions',
      issuedAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: parsed.data.workflowId ?? 'workflow-test',
        ...(parsed.data.executionId ? { executionId: parsed.data.executionId } : {}),
      },
    },
    ...(auth.sandboxProfile === 'mothership' ? { sandboxProfile: 'mothership' } : {}),
  })
}

afterAll(resetEnvFlagsMock)

/**
 * A `<block.file.path>` reference as it reaches the function runtime: the resolver
 * leaves a mount marker in the context variables, which is what asks this run for a
 * sandbox filesystem.
 */
const MOUNT_REF = {
  __simSandboxFileMount: true,
  version: 1,
  file: {
    id: 'file_1',
    name: 'doc.pdf',
    url: 'https://storage.example/doc.pdf',
    size: 12,
    type: 'application/pdf',
    key: 'execution/workspace-1/wf-1/exec-1/abc/doc.pdf',
    context: 'execution',
  },
}

describe('Function execution request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envFlagsMock.isRemoteSandboxEnabled = false
    envFlagsMock.isMothershipSandboxEnabled = false

    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })

    mockExecuteInIsolatedVM.mockResolvedValue({ result: 'test', stdout: '' })
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
    clearLargeValueCacheForTests()

    mockExecuteInSandbox.mockResolvedValue({
      result: 'e2b success',
      stdout: 'e2b output',
      sandboxId: 'test-sandbox-id',
    })
    mockExecuteShellInSandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'test-shell-sandbox-id',
    })
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'wf_existing',
      name: 'existing.png',
      size: 10,
      type: 'image/png',
      url: '/api/files/view/existing',
      key: 'workspace/existing.png',
    })
    mockUpdateWorkspaceFileContent.mockResolvedValue({
      id: 'wf_existing',
      name: 'existing.png',
      size: 20,
      type: 'image/png',
      url: '/api/files/view/existing',
      key: 'workspace/existing.png',
    })
    mockResolveWorkspaceFileReference.mockResolvedValue({
      id: 'wf_existing',
      workspaceId: 'workspace-1',
      name: 'existing.txt',
      size: 0,
      key: 'workspace/existing.txt',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.alloc(0))
    mockValidateWorkspaceFileWriteTarget.mockImplementation(async ({ target }) => ({
      mode: target.mode,
      vfsPath: target.path,
    }))
    mockWriteWorkspaceFileByPath.mockImplementation(async ({ target, buffer }) => ({
      id: `wf_${String(target.path).split('/').pop()?.replace(/\W+/g, '_') || 'file'}`,
      name: String(target.path).split('/').pop() || 'file',
      vfsPath: target.path,
      downloadUrl: `/api/files/view/${encodeURIComponent(target.path)}`,
      mode: target.mode,
      size: buffer.length,
      contentType: target.mimeType || 'application/octet-stream',
    }))
  })

  describe('Security Tests', () => {
    it('should reject unauthorized requests', async () => {
      hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized',
      })

      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('rejects a sandbox output export through the workspace-file application policy', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        cost: { input: 0, output: 0, total: 0.00012345 },
        exportedFiles: { '/tmp/out.txt': 'owned by attacker' },
      })
      mockWriteWorkspaceFileByPath.mockRejectedValueOnce(
        new OrchestrationError('forbidden', 'Insufficient workspace permissions')
      )

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-victim',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        outputs: {
          files: [{ path: 'files/README.md', mode: 'overwrite', sandboxPath: '/tmp/out.txt' }],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Insufficient workspace permissions')
      expect(data.output.cost).toEqual({ input: 0, output: 0, total: 0.00012345 })
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(1)
    })

    it('runs import-free JavaScript in isolated-vm without a remote provider', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output.result).toBe('test')
      expect(mockExecuteInIsolatedVM).toHaveBeenCalledTimes(1)
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
      expect(mockExecuteShellInSandbox).not.toHaveBeenCalled()
    })

    it.each([
      { language: 'python', code: 'return 42', kind: 'code' },
      { language: 'shell', code: 'echo ready', kind: 'shell' },
    ])(
      'meters a standard workflow Function $kind sandbox and preserves its cost',
      async ({ language, code, kind }) => {
        envFlagsMock.isRemoteSandboxEnabled = true
        const cost = { input: 0, output: 0, total: 0.00012345 }
        const executeSandbox = kind === 'shell' ? mockExecuteShellInSandbox : mockExecuteInSandbox
        executeSandbox.mockResolvedValueOnce({
          result: 42,
          stdout: 'ready',
          sandboxId: `sandbox-${kind}`,
          cost,
        })

        const response = await POST(
          createMockRequest('POST', {
            code,
            language,
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            executionId: 'execution-1',
          })
        )
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(executeSandbox).toHaveBeenCalledWith(expect.objectContaining({ meterUsage: true }))
        expect(data.output.cost).toEqual(cost)
      }
    )

    it.each([
      {
        language: 'javascript',
        code: 'import "node:path"\nthrow new Error("boom")',
        kind: 'code',
      },
      { language: 'python', code: 'raise ValueError("boom")', kind: 'code' },
      { language: 'shell', code: 'exit 1', kind: 'shell' },
    ])(
      'preserves sandbox cost in a failed remote $language Function response',
      async ({ language, code, kind }) => {
        envFlagsMock.isRemoteSandboxEnabled = true
        const cost = { input: 0, output: 0, total: 0.00012345 }
        const executeSandbox = kind === 'shell' ? mockExecuteShellInSandbox : mockExecuteInSandbox
        executeSandbox.mockResolvedValueOnce({
          result: null,
          stdout: 'boom',
          error: 'boom',
          sandboxId: `sandbox-${language}`,
          cost,
        })

        const response = await POST(
          createMockRequest('POST', {
            code,
            language,
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            executionId: 'execution-1',
          })
        )
        const data = await response.json()

        expect(response.status).toBe(422)
        expect(executeSandbox).toHaveBeenCalledWith(expect.objectContaining({ meterUsage: true }))
        expect(data.output.cost).toEqual(cost)
      }
    )

    it('does not meter a non-workflow remote Function call', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const response = await POST(
        createMockRequest('POST', {
          code: 'import path from "node:path"\nreturn path.sep',
          language: 'javascript',
        })
      )

      expect(response.status).toBe(200)
      expect(mockExecuteInSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ meterUsage: false })
      )
    })

    it('keeps a custom Function tool local even when workflow context is present', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const response = await POST(
        createMockRequest('POST', {
          code: 'return 42',
          language: 'python',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
          isCustomTool: true,
        })
      )

      expect(response.status).toBe(200)
      expect(mockExecuteInIsolatedVM).toHaveBeenCalledOnce()
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    it('does not accept a Mothership sandbox profile from the request body', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        sandboxProfile: 'mothership',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockExecuteInIsolatedVM).toHaveBeenCalledTimes(1)
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    it('fails closed when a trusted Mothership call has no configured image', async () => {
      hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'internal_jwt',
        sandboxProfile: 'mothership',
      })

      const response = await POST(
        createMockRequest('POST', { code: 'return "test"', language: 'javascript' })
      )

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: 'Mothership code sandbox is not configured',
      })
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    it.each([
      { language: 'javascript', code: 'return 42' },
      { language: 'python', code: '__sim_result__ = 42' },
    ])(
      'runs trusted Mothership $language in the Mothership sandbox image',
      async ({ language, code }) => {
        envFlagsMock.isMothershipSandboxEnabled = true
        hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
          success: true,
          userId: 'user-123',
          authType: 'internal_jwt',
          sandboxProfile: 'mothership',
        })

        const response = await POST(createMockRequest('POST', { code, language }))

        expect(response.status).toBe(200)
        expect(mockExecuteInSandbox).toHaveBeenCalledWith(
          expect.objectContaining({
            language,
            sandboxKind: 'mothership',
            meterUsage: false,
          })
        )
        expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      }
    )

    it('runs trusted Mothership Shell in the Mothership sandbox image', async () => {
      envFlagsMock.isMothershipSandboxEnabled = true
      hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'internal_jwt',
        sandboxProfile: 'mothership',
      })

      const response = await POST(
        createMockRequest('POST', { code: 'echo ready', language: 'shell' })
      )

      expect(response.status).toBe(200)
      expect(mockExecuteShellInSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ sandboxKind: 'mothership', meterUsage: false })
      )
    })

    it.each([
      { language: 'javascript', code: 'return 42' },
      { language: 'python', code: '__sim_result__ = 42' },
    ])(
      'runs trusted Mothership $language in the selected Function-based Sim sandbox',
      async ({ language, code }) => {
        envFlagsMock.isRemoteSandboxEnabled = true
        hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
          success: true,
          userId: 'user-123',
          authType: 'internal_jwt',
          sandboxProfile: 'mothership',
        })

        const response = await POST(
          createMockRequest('POST', {
            code,
            language,
            workspaceId: 'workspace-1',
            sandboxId: 'sandbox-1',
          })
        )

        expect(response.status).toBe(200)
        const request = mockExecuteInSandbox.mock.calls.at(-1)?.[0]
        expect(request).toMatchObject({
          language,
          workspaceId: 'workspace-1',
          sandboxId: 'sandbox-1',
        })
        expect(request).not.toHaveProperty('sandboxKind')
      }
    )

    it('runs trusted Mothership Shell in the selected Sim sandbox', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'internal_jwt',
        sandboxProfile: 'mothership',
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'kubectl version --client',
          language: 'shell',
          workspaceId: 'workspace-1',
          sandboxId: 'sandbox-1',
        })
      )

      expect(response.status).toBe(200)
      const request = mockExecuteShellInSandbox.mock.calls.at(-1)?.[0]
      expect(request).toMatchObject({
        workspaceId: 'workspace-1',
        sandboxId: 'sandbox-1',
      })
      expect(request).not.toHaveProperty('sandboxKind')
    })

    it('does not treat the Mothership base as a fallback for a selected Sim sandbox', async () => {
      envFlagsMock.isMothershipSandboxEnabled = true
      hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'internal_jwt',
        sandboxProfile: 'mothership',
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'return 42',
          language: 'javascript',
          workspaceId: 'workspace-1',
          sandboxId: 'sandbox-1',
        })
      )

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({
        error: 'The Function code sandbox is not configured',
      })
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    })

    it('forces import-free JavaScript into the remote runtime when a Sim sandbox is selected', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const response = await POST(
        createMockRequest('POST', {
          code: 'return 42',
          language: 'javascript',
          workspaceId: 'workspace-1',
          sandboxId: 'sandbox-1',
        })
      )

      expect(response.status).toBe(200)
      expect(mockExecuteInSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'javascript',
          workspaceId: 'workspace-1',
          sandboxId: 'sandbox-1',
        })
      )
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    })

    it('should prevent VM escape via constructor chain', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: undefined, stdout: '' })

      const req = createMockRequest('POST', {
        code: 'return this.constructor.constructor("return process")().env',
      })

      const response = await POST(req)
      const data = await response.json()

      if (response.status === 422 || response.status === 500) {
        expect(data.success).toBe(false)
      } else {
        const result = data.output?.result
        expect(result === undefined || result === null).toBe(true)
      }
    })

    it.concurrent('should prevent access to require via constructor chain', async () => {
      const req = createMockRequest('POST', {
        code: `
          const proc = this.constructor.constructor("return process")();
          const fs = proc.mainModule.require("fs");
          return fs.readFileSync("/etc/passwd", "utf8");
        `,
      })

      const response = await POST(req)
      const data = await response.json()

      if (response.status === 200) {
        const result = data.output?.result
        if (result !== undefined && result !== null && typeof result === 'string') {
          expect(result).not.toContain('root:')
        }
      }
    })

    it('should not expose process object', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'undefined', stdout: '' })

      const req = createMockRequest('POST', {
        code: 'return typeof process',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.output.result).toBe('undefined')
    })

    it('should not expose require function', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'undefined', stdout: '' })

      const req = createMockRequest('POST', {
        code: 'return typeof require',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.output.result).toBe('undefined')
    })

    it.concurrent('should block SSRF attacks through secure fetch wrapper', async () => {
      expect(validateProxyUrl('http://169.254.169.254/latest/meta-data/').isValid).toBe(false)
      expect(validateProxyUrl('http://127.0.0.1:8080/admin').isValid).toBe(true)
      expect(validateProxyUrl('http://192.168.1.1/config').isValid).toBe(false)
      expect(validateProxyUrl('http://10.0.0.1/internal').isValid).toBe(false)
    })

    it.concurrent('should allow legitimate external URLs', async () => {
      expect(validateProxyUrl('https://api.github.com/user').isValid).toBe(true)
      expect(validateProxyUrl('https://httpbin.org/get').isValid).toBe(true)
      expect(validateProxyUrl('https://example.com/api').isValid).toBe(true)
    })

    it.concurrent('should block dangerous protocols', async () => {
      expect(validateProxyUrl('file:///etc/passwd').isValid).toBe(false)
      expect(validateProxyUrl('ftp://internal.server/files').isValid).toBe(false)
      expect(validateProxyUrl('gopher://old.server/menu').isValid).toBe(false)
    })
  })

  describe('Basic Function Execution', () => {
    it.concurrent('should execute simple JavaScript code successfully', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Hello World"',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output).toHaveProperty('result')
      expect(data.output).toHaveProperty('executionTime')
    })

    it('compacts large array result fields to manifests when execution context is durable', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: {
          rows: Array.from({ length: 120_000 }, (_, index) => ({
            key: `SIM-${index}`,
            payload: 'x'.repeat(100),
          })),
        },
        stdout: '',
      })

      const req = createMockRequest('POST', {
        code: 'return rows',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(isLargeArrayManifest(data.output.result.rows)).toBe(true)
      expect(data.output.result.rows).toMatchObject({
        __simLargeArrayManifest: true,
        kind: 'array',
        totalCount: 120_000,
      })
    })

    it('keeps large string result fields as generic large value refs', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: {
          text: 'x'.repeat(9 * 1024 * 1024),
        },
        stdout: '',
      })

      const req = createMockRequest('POST', {
        code: 'return text',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(isLargeValueRef(data.output.result.text)).toBe(true)
    })

    it('captures secret provenance before a large result is compacted', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: { text: `${'x'.repeat(9 * 1024 * 1024)}secret-at-the-end` },
        stdout: '',
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{API_KEY}}',
            envVars: { API_KEY: 'secret-at-the-end' },
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            executionId: 'execution-1',
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )
      const data = await response.json()

      expect(isLargeValueRef(data.output.result.text)).toBe(true)
      expect(data.__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it('exports multiple declared sandbox output files', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        cost: { input: 0, output: 0, total: 0.00023456 },
        exportedFiles: {
          '/home/user/chart.png': 'iVBORw0KGgo=',
          '/home/user/summary.json': '{"ok":true}',
        },
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        outputs: {
          files: [
            {
              path: 'files/reports/chart.png',
              mode: 'create',
              sandboxPath: '/home/user/chart.png',
              mimeType: 'image/png',
            },
            {
              path: 'files/reports/summary.json',
              mode: 'overwrite',
              sandboxPath: '/home/user/summary.json',
              mimeType: 'application/json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockExecuteInSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          outputSandboxPaths: ['/home/user/chart.png', '/home/user/summary.json'],
        })
      )
      expect(mockValidateWorkspaceFileWriteTarget).toHaveBeenCalledTimes(2)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(2)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          target: expect.objectContaining({ path: 'files/reports/chart.png', mode: 'create' }),
        })
      )
      expect(mockWriteWorkspaceFileByPath).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          target: expect.objectContaining({
            path: 'files/reports/summary.json',
            mode: 'overwrite',
          }),
        })
      )
      expect(data.output.result.files).toHaveLength(2)
      expect(data.output.cost).toEqual({ input: 0, output: 0, total: 0.00023456 })
      expect(data.resources).toEqual([
        expect.objectContaining({ path: 'files/reports/chart.png' }),
        expect.objectContaining({ path: 'files/reports/summary.json' }),
      ])
    })

    it('atomically classifies text exports and acknowledges the durable v2 capability', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/secret.txt': 'Bearer secret-value' },
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'print("{{API_KEY}}")',
            language: 'python',
            workspaceId: 'workspace-1',
            envVars: { API_KEY: 'secret-value' },
            outputs: {
              files: [
                {
                  path: 'files/secret.txt',
                  sandboxPath: '/home/user/secret.txt',
                  mimeType: 'text/plain',
                },
              ],
            },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          }
        )
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
        'resolved-secret-names-durable-files-v2'
      )
      expect(data).not.toHaveProperty('__resolvedSecretFileNames')
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          secretProvenance: {
            status: 'exact',
            entries: [
              {
                name: 'API_KEY',
                encryptedValue: 'encrypted:secret-value',
                sourceUserId: 'user-123',
                sourceWorkspaceId: 'workspace-1',
              },
            ],
          },
        })
      )
    })

    it('classifies exports exact-empty when the only compiled secret is exempt, still reporting its name', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: {
          '/home/user/secret.txt': 'Bearer secret-value',
          '/home/user/small.jpg': '/9j/4AAQ',
        },
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'print("{{API_KEY}}")',
            language: 'python',
            workspaceId: 'workspace-1',
            envVars: { API_KEY: 'secret-value' },
            unredactedSecretNames: ['API_KEY'],
            outputs: {
              files: [
                {
                  path: 'files/secret.txt',
                  sandboxPath: '/home/user/secret.txt',
                  mimeType: 'text/plain',
                },
                {
                  path: 'files/small.jpg',
                  sandboxPath: '/home/user/small.jpg',
                  mimeType: 'image/jpeg',
                },
              ],
            },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          }
        )
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      // The text export carries the exempt plaintext yet records no entry for it.
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ path: 'files/secret.txt' }),
          secretProvenance: { status: 'exact', entries: [] },
        })
      )
      // With only exempt material in scope the binary export must not lock as unknown.
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ path: 'files/small.jpg' }),
          secretProvenance: { status: 'exact', entries: [] },
        })
      )
      // The exemption changes file classification only — the usage trail still sees the name.
      expect(data.__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it('keeps recording the non-exempt owner when an exempt name shares its plaintext', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/secret.txt': 'Bearer shared-value' },
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("{{EXEMPT_KEY}}", "{{OTHER_KEY}}")',
          language: 'python',
          workspaceId: 'workspace-1',
          envVars: { EXEMPT_KEY: 'shared-value', OTHER_KEY: 'shared-value' },
          unredactedSecretNames: ['EXEMPT_KEY'],
          outputs: {
            files: [
              {
                path: 'files/secret.txt',
                sandboxPath: '/home/user/secret.txt',
                mimeType: 'text/plain',
              },
            ],
          },
        })
      )

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          secretProvenance: {
            status: 'exact',
            entries: [
              {
                name: 'OTHER_KEY',
                encryptedValue: 'encrypted:shared-value',
                sourceUserId: 'user-123',
                sourceWorkspaceId: 'workspace-1',
              },
            ],
          },
        })
      )
    })

    it('classifies text exports against private mounted-file provenance', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/copied.txt': 'Bearer mounted-secret' },
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'print("done")',
            language: 'python',
            workspaceId: 'workspace-1',
            outputs: {
              files: [
                {
                  path: 'files/copied.txt',
                  sandboxPath: '/home/user/copied.txt',
                  mimeType: 'text/plain',
                },
              ],
            },
            [PRIVATE_SECRET_PROVENANCE_FIELD]: {
              version: 1,
              complete: true,
              selections: [
                {
                  key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
                  provenance: {
                    version: 1,
                    complete: true,
                    entries: [{ encryptedValue: 'encrypted:mounted-secret' }],
                    scope: { userId: 'user-123', workspaceId: 'workspace-1' },
                  },
                },
              ],
            },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
            [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
          }
        )
      )

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          secretProvenance: {
            status: 'exact',
            entries: [
              {
                name: 'MOUNTED_FILE_SECRET',
                encryptedValue: 'encrypted:mounted-secret',
                sourceUserId: 'user-123',
                sourceWorkspaceId: 'workspace-1',
              },
            ],
          },
        })
      )
    })

    it('rejects a partial mounted-file provenance envelope before execution', async () => {
      const response = await POST(
        createMockRequest('POST', {
          code: 'return 1',
          [PRIVATE_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: true,
            selections: [
              {
                key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
                provenance: { version: 1, complete: true, entries: [] },
              },
            ],
          },
        })
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Mounted file secret provenance is invalid',
      })
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    it('runs with authenticated incomplete mount provenance and marks exported bytes unknown', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'raw result',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/output.txt': 'raw output' },
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'print("done")',
            language: 'python',
            workspaceId: 'workspace-1',
            outputs: {
              files: [
                {
                  path: 'files/output.txt',
                  sandboxPath: '/home/user/output.txt',
                  mimeType: 'text/plain',
                },
              ],
            },
            [PRIVATE_SECRET_PROVENANCE_FIELD]: {
              version: 1,
              complete: false,
              selections: [],
            },
          },
          { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 }
        )
      )

      expect(response.status).toBe(200)
      expect((await response.json()).output.result).toEqual(
        expect.objectContaining({ fileId: 'wf_output_txt', vfsPath: 'files/output.txt' })
      )
      expect(mockExecuteInSandbox).toHaveBeenCalledOnce()
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: Buffer.from('raw output'),
          secretProvenance: { status: 'unknown' },
        })
      )
    })

    it('does not rewrite a static export path that happens to equal a resolved secret', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/report.txt': 'safe content' },
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("done")',
          language: 'python',
          workspaceId: 'workspace-1',
          envVars: { API_KEY: 'secret-value' },
          outputs: {
            files: [
              {
                path: 'files/report-secret-value.txt',
                sandboxPath: '/home/user/report.txt',
                mimeType: 'text/plain',
              },
            ],
          },
        })
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ path: 'files/report-secret-value.txt' }),
          secretProvenance: { status: 'exact', entries: [] },
        })
      )
      expect(JSON.stringify(data)).toContain('files/report-secret-value.txt')
    })

    it('classifies a binary export exact-empty when no secret was in scope', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/small.jpg': '/9j/4AAQ' },
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("done")',
          language: 'python',
          workspaceId: 'workspace-1',
          outputs: {
            files: [
              {
                path: 'files/small.jpg',
                sandboxPath: '/home/user/small.jpg',
                mimeType: 'image/jpeg',
              },
            ],
          },
        })
      )

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({ secretProvenance: { status: 'exact', entries: [] } })
      )
    })

    it('classifies a binary export exact-empty when ordinary files were mounted without secret provenance', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/small.jpg': '/9j/4AAQ' },
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("done")',
          language: 'python',
          workspaceId: 'workspace-1',
          _sandboxFiles: [{ path: '/home/user/in.bin', content: 'mounted bytes' }],
          outputs: {
            files: [
              {
                path: 'files/small.jpg',
                sandboxPath: '/home/user/small.jpg',
                mimeType: 'image/jpeg',
              },
            ],
          },
        })
      )

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({ secretProvenance: { status: 'exact', entries: [] } })
      )
    })

    it('keeps a binary export unknown when a mounted input file carried a secret', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/small.jpg': '/9j/4AAQ' },
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'print("done")',
            language: 'python',
            workspaceId: 'workspace-1',
            outputs: {
              files: [
                {
                  path: 'files/small.jpg',
                  sandboxPath: '/home/user/small.jpg',
                  mimeType: 'image/jpeg',
                },
              ],
            },
            [PRIVATE_SECRET_PROVENANCE_FIELD]: {
              version: 1,
              complete: true,
              selections: [
                {
                  key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
                  provenance: {
                    version: 1,
                    complete: true,
                    entries: [{ encryptedValue: 'encrypted:mounted-secret' }],
                    scope: { userId: 'user-123', workspaceId: 'workspace-1' },
                  },
                },
              ],
            },
          },
          {
            [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
          }
        )
      )

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({ secretProvenance: { status: 'unknown' } })
      )
    })

    it('marks binary exports unknown without failing the Function execution', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: '',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/archive.zip': 'UEsDBA==' },
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("{{API_KEY}}")',
          language: 'python',
          workspaceId: 'workspace-1',
          envVars: { API_KEY: 'secret-value' },
          outputs: {
            files: [
              {
                path: 'files/archive.zip',
                sandboxPath: '/home/user/archive.zip',
                mimeType: 'application/zip',
              },
            ],
          },
        })
      )

      expect(response.status).toBe(200)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({ secretProvenance: { status: 'unknown' } })
      )
    })

    it('rejects one oversized sandbox output before creating a workspace file buffer', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: {
          '/home/user/report.json': 'x'.repeat(MAX_SANDBOX_OUTPUT_BYTES + 1),
        },
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/report.json',
              sandboxPath: '/home/user/report.json',
              mimeType: 'application/json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(`Sandbox output files exceed ${MAX_SANDBOX_OUTPUT_BYTES} bytes total`)
      expect(mockValidateWorkspaceFileWriteTarget).not.toHaveBeenCalled()
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('rejects cumulative sandbox output size before validating workspace destinations', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const fileSize = MAX_SANDBOX_OUTPUT_BYTES / 2 + 1
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: {
          '/home/user/first.json': 'x'.repeat(fileSize),
          '/home/user/second.json': 'y'.repeat(fileSize),
        },
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/first.json',
              sandboxPath: '/home/user/first.json',
              mimeType: 'application/json',
            },
            {
              path: 'files/second.json',
              sandboxPath: '/home/user/second.json',
              mimeType: 'application/json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(`Sandbox output files exceed ${MAX_SANDBOX_OUTPUT_BYTES} bytes total`)
      expect(mockValidateWorkspaceFileWriteTarget).not.toHaveBeenCalled()
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('preserves output-limit classification from provider-side size inspection', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const error = new SandboxOutputLimitError(MAX_SANDBOX_OUTPUT_BYTES + 1)
      const cost = { input: 0, output: 0, total: 0.00023456 }
      attachTrustedSandboxOutputCost(error, cost)
      mockExecuteInSandbox.mockRejectedValueOnce(error)

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/report.json',
              sandboxPath: '/home/user/report.json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(`Sandbox output files exceed ${MAX_SANDBOX_OUTPUT_BYTES} bytes total`)
      expect(data.output.cost).toEqual(cost)
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('rejects non-regular sandbox output paths as a client error', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockRejectedValueOnce(new SandboxOutputFileError('/out/link.json'))

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("done")',
          language: 'python',
          workspaceId: 'workspace-1',
          outputs: {
            files: [{ path: 'files/report.json', sandboxPath: '/out/link.json' }],
          },
        })
      )
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('must reference a regular file')
      expect(data.output.cost).toBeUndefined()
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it.each(['/', '///', ' / '])(
      'rejects malformed workspace output destination %j before sandbox execution',
      async (path) => {
        envFlagsMock.isRemoteSandboxEnabled = true

        const response = await POST(
          createMockRequest('POST', {
            code: 'print("done")',
            language: 'python',
            workspaceId: 'workspace-1',
            outputs: {
              files: [{ path, sandboxPath: '/out/report.json' }],
            },
          })
        )
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe('Output path must include a file name')
        expect(mockExecuteInSandbox).not.toHaveBeenCalled()
        expect(mockExecuteShellInSandbox).not.toHaveBeenCalled()
      }
    )

    it('prevalidates all sandbox output destinations before writing any files', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        cost: { input: 0, output: 0, total: 0.00023456 },
        exportedFiles: {
          '/home/user/first.json': '{"first":true}',
          '/home/user/second.json': '{"second":true}',
        },
      })
      mockValidateWorkspaceFileWriteTarget
        .mockResolvedValueOnce({ mode: 'create', vfsPath: 'files/first.json' })
        .mockRejectedValueOnce(new Error('Directory not yet created: files/missing'))

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        outputs: {
          files: [
            {
              path: 'files/first.json',
              mode: 'create',
              sandboxPath: '/home/user/first.json',
            },
            {
              path: 'files/missing/second.json',
              mode: 'create',
              sandboxPath: '/home/user/second.json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Directory not yet created')
      expect(data.output.cost).toEqual({ input: 0, output: 0, total: 0.00023456 })
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('rejects duplicate sandbox output destinations before writing files', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: {
          '/home/user/first.json': '{"first":true}',
          '/home/user/second.json': '{"second":true}',
        },
      })
      mockValidateWorkspaceFileWriteTarget.mockResolvedValue({
        mode: 'create',
        vfsPath: 'files/dupe.json',
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/dupe.json',
              mode: 'create',
              sandboxPath: '/home/user/first.json',
            },
            {
              path: 'files/dupe.json',
              mode: 'create',
              sandboxPath: '/home/user/second.json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Duplicate sandbox output destination')
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('returns a targeted error when a declared sandbox output is missing', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: {},
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/missing.json',
              mode: 'create',
              sandboxPath: '/home/user/missing.json',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Sandbox file "/home/user/missing.json" was not found')
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('routes plain JavaScript to the remote sandbox when it declares a sandboxPath output', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const req = createMockRequest('POST', {
        code: 'return "content"',
        language: 'javascript',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/doc.md',
              mode: 'overwrite',
              sandboxPath: '/home/user/doc.md',
            },
          ],
        },
      })

      await POST(req)

      // Needing a sandbox filesystem selects the remote runtime the same way a
      // selected sandbox image does. Refusing here instead would dead-end the
      // caller: "add an import" is not a fix anyone should have to discover.
      expect(mockExecuteInSandbox).toHaveBeenCalled()
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    })

    it('refuses sandbox file inputs/outputs when no remote sandbox is configured', async () => {
      envFlagsMock.isRemoteSandboxEnabled = false

      const req = createMockRequest('POST', {
        code: 'return "content"',
        language: 'javascript',
        workspaceId: 'workspace-1',
        contextVariables: { doc: MOUNT_REF },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('no sandbox filesystem')
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('refuses sandbox file inputs/outputs for a custom tool, which always runs in isolated-vm', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const req = createMockRequest('POST', {
        code: 'return "content"',
        language: 'javascript',
        workspaceId: 'workspace-1',
        isCustomTool: true,
        contextVariables: { doc: MOUNT_REF },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('custom tools always run in the isolated JavaScript VM')
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    it('reports a harvest the sandbox refused as a 400 carrying its reason', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockRejectedValueOnce(
        Object.assign(new Error('Sandbox produced 21 files in /tmp/sim/outputs'), {
          code: 'sandbox_output_not_exportable',
        })
      )

      const req = createMockRequest('POST', {
        code: 'x',
        language: 'python',
        workspaceId: 'workspace-1',
      })

      const response = await POST(req)
      const data = await response.json()

      // Writing too many files is the caller's to fix, so it must not surface
      // as an opaque 500 that hides the count and the remedy.
      expect(response.status).toBe(400)
      expect(data.error).toContain('21 files')
    })

    it('scans a harvested plaintext secret even under a binary file name', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: '',
        sandboxId: 'sbx',
        collectedFiles: [
          {
            path: '/tmp/sim/outputs/leak.png',
            relativePath: 'leak.png',
            // Valid UTF-8 carrying the resolved secret, named as an image.
            contentBase64: Buffer.from('token=super-secret-value').toString('base64'),
            byteLength: 24,
          },
        ],
      })

      const req = createMockRequest('POST', {
        // The placeholder has to be in the code: compiling it is what puts the
        // resolved value in scope for the output scan.
        code: 'token = {{MY_SECRET}}',
        language: 'python',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        envVars: { MY_SECRET: 'super-secret-value' },
      })

      const response = await POST(req)
      const data = await response.json()

      // Classifying by file name let a secret written as plaintext under a
      // binary extension skip the only provenance guard and be returned with a
      // downloadable URL. Content decides now, so the name cannot dodge it.
      expect(response.status).toBe(400)
      expect(data.error).toContain('leak.png')
      expect(data.error).toContain('resolved secret')
    })

    it('scans a harvested secret even when one invalid byte makes it non-UTF-8', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: '',
        sandboxId: 'sbx',
        collectedFiles: [
          {
            path: '/tmp/sim/outputs/mixed.bin',
            relativePath: 'mixed.bin',
            // Literal secret plus one invalid byte, so the buffer is not valid
            // UTF-8 — which used to be enough to skip the scan entirely.
            contentBase64: Buffer.concat([
              Buffer.from('token=super-secret-value'),
              Buffer.from([0xff]),
            ]).toString('base64'),
            byteLength: 25,
          },
        ],
      })

      const req = createMockRequest('POST', {
        code: 'token = {{MY_SECRET}}',
        language: 'python',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        envVars: { MY_SECRET: 'super-secret-value' },
      })

      const response = await POST(req)
      const data = await response.json()

      // A lossy UTF-8 decode keeps ASCII runs intact, so the literal is still
      // there to find — appending a byte must not buy an exemption.
      expect(response.status).toBe(400)
      expect(data.error).toContain('mixed.bin')
      expect(data.error).toContain('resolved secret')
    })

    it('mounts a <block.file.path> reference and hands the code its path', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const req = createMockRequest('POST', {
        code: 'x',
        language: 'python',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        contextVariables: { doc: MOUNT_REF },
      })

      await POST(req)

      const call = mockExecuteInSandbox.mock.calls[0]?.[0]
      expect(call.sandboxFiles).toEqual([
        { type: 'url', path: '/tmp/sim/inputs/doc.pdf', url: 'https://presigned.example/object' },
      ])
      // The marker must not survive into the code's view of the variable — the
      // whole point is that every language sees a plain path string.
      const runtimePayload = call.privateInputs
        .map((input: { content: string }) => input.content)
        .find((content: string) => content.includes('contextVariables'))
      expect(runtimePayload).toContain('/tmp/sim/inputs/doc.pdf')
      expect(runtimePayload).not.toContain('__simSandboxFileMount')
    })

    it('harvests the output directory on every remote run, with no toggle', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const req = createMockRequest('POST', {
        code: 'x',
        language: 'python',
        workspaceId: 'workspace-1',
      })

      await POST(req)

      expect(mockExecuteInSandbox.mock.calls[0]?.[0].outputSandboxDir).toBe('/tmp/sim/outputs')
    })

    it('does not ask for an output directory on an isolate run', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const req = createMockRequest('POST', {
        code: 'return 1',
        language: 'javascript',
        workspaceId: 'workspace-1',
      })

      await POST(req)

      // Harvesting is free only because it rides an existing sandbox; an
      // isolate run must not gain one just to look for files.
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
      expect(mockExecuteInIsolatedVM).toHaveBeenCalled()
    })

    it('leaves a plain JavaScript call with no file inputs or outputs in isolated-vm', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      const req = createMockRequest('POST', {
        code: 'return "content"',
        language: 'javascript',
        workspaceId: 'workspace-1',
      })

      await POST(req)

      expect(mockExecuteInIsolatedVM).toHaveBeenCalled()
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    it('rejects sandbox file mounts when the call would run in isolated-vm', async () => {
      const req = createMockRequest('POST', {
        code: 'return 1',
        language: 'javascript',
        workspaceId: 'workspace-1',
        _sandboxFiles: [{ path: '/home/user/files/data.csv', content: 'a,b\n1,2' }],
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      // No remote sandbox is enabled in this test, so the remediation must name
      // that cause instead of suggesting python (which would also fail without one).
      expect(data.error).toContain('No remote code sandbox is enabled')
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    })

    it('flags an overwrite export whose bytes are identical to the current file content as unchanged', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const staleContent = '# doc\nunchanged mounted content\n'
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/doc.md': staleContent },
      })
      mockResolveWorkspaceFileReference.mockResolvedValue({
        id: 'wf_doc',
        name: 'doc.md',
        size: Buffer.byteLength(staleContent, 'utf-8'),
        key: 'workspace/doc.md',
      })
      mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from(staleContent, 'utf-8'))

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/doc.md',
              mode: 'overwrite',
              sandboxPath: '/home/user/doc.md',
              mimeType: 'text/markdown',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      // Idempotent overwrites (retries, unchanged regenerations) must not fail;
      // the write proceeds and the receipt carries the loud unchanged signal so
      // the model can tell its "new content" never reached the sandbox file.
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(1)
      expect(data.output.result.unchanged).toBe(true)
      expect(data.output.result.message).toContain('byte-identical to the previous version')
      expect(data.output.result.message).toContain('/home/user/doc.md')
    })

    it('continues an overwrite when the advisory comparison fails', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const newContent = '# doc\nnew content\n'
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/doc.md': newContent },
      })
      mockResolveWorkspaceFileReference.mockRejectedValueOnce(
        new Error('comparison storage unavailable')
      )

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("done")',
          language: 'python',
          workspaceId: 'workspace-1',
          outputs: {
            files: [
              {
                path: 'files/doc.md',
                mode: 'overwrite',
                sandboxPath: '/home/user/doc.md',
                mimeType: 'text/markdown',
              },
            ],
          },
        })
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(1)
      expect(data.output.result).toMatchObject({ unchanged: false })
      expect(data.output.result).not.toHaveProperty('previousSize')
    })

    it('reports size, previousSize, and sha256 receipts on a successful overwrite export', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const newContent = '# doc\nnew content\n'
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: { '/home/user/doc.md': newContent },
      })
      mockResolveWorkspaceFileReference.mockResolvedValue({
        id: 'wf_doc',
        name: 'doc.md',
        size: 36728,
        key: 'workspace/doc.md',
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
        outputs: {
          files: [
            {
              path: 'files/doc.md',
              mode: 'overwrite',
              sandboxPath: '/home/user/doc.md',
              mimeType: 'text/markdown',
            },
          ],
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      // Sizes differ, so the current content is never downloaded for comparison.
      expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
      expect(data.output.result.size).toBe(Buffer.byteLength(newContent, 'utf-8'))
      expect(data.output.result.previousSize).toBe(36728)
      expect(data.output.result.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(data.output.result.unchanged).toBe(false)
      expect(data.output.result.message).toContain('replaced 36728 bytes')
      expect(data.output.result.message).toContain('sha256:')
      // The python wrapper prints the marker with a leading \n so it always
      // starts a fresh line even after non-newline-terminated user output.
      const e2bCode = mockExecuteInSandbox.mock.calls[0][0].code as string
      expect(e2bCode).toContain("print('\\n__SIM_RESULT__=' + json.dumps(__sim_result__))")
    })

    it('runs complete Python modules without nesting their main guard inside a function', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const source = [
        'import subprocess',
        '',
        'def main():',
        '    subprocess.run(["bq", "version"], check=True)',
        '',
        'if __name__ == "__main__":',
        '    main()',
      ].join('\n')

      const response = await POST(
        createMockRequest('POST', {
          code: source,
          language: 'python',
          workspaceId: 'workspace-1',
        })
      )

      expect(response.status).toBe(200)
      const e2bCode = mockExecuteInSandbox.mock.calls[0][0].code as string
      expect(e2bCode).toContain('compile(__sim_source__, "<sim-function-module>", "exec")')
      expect(e2bCode).toContain('__sim_exec_globals__["__name__"] = "__main__"')
      expect(e2bCode).toContain(JSON.stringify(source))
      expect(e2bCode).not.toContain('def __sim_main__():\n    import subprocess')
    })

    it('supports a Fellows-style Python module that invokes bq and exports a deterministic archive', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const archiveBase64 =
        'UEsDBBQAAAAIAAAAIQAcWyFBIAAAAB8AAAAMAAAAcHJldmlldy5odG1ss8kwtHNLzcnJLy9WcM4vzUvOzFEIT03Nzqm00QdKAQBQSwECFAMUAAAACAAAACEAHFshQSAAAAAfAAAADAAAAAAAAAAAAAAAgAEAAAAAcHJldmlldy5odG1sUEsFBgAAAAABAAEAOgAAAEoAAAAAAA=='
      const source = readFileSync(
        resolve(process.cwd(), 'lib/execution/remote-sandbox/fixtures/fellows-council-weekly.py'),
        'utf8'
      )
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: 'generated 1 preview',
        sandboxId: 'sandbox-123',
        cost: { input: 0, output: 0, total: 0.00034567 },
        exportedFiles: { '/tmp/fellows-previews.zip': archiveBase64 },
      })

      const response = await POST(
        createMockRequest('POST', {
          code: source,
          language: 'python',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          sandboxId: 'fellows-sandbox',
          envVars: {
            AIRTABLE_PAT: 'stub-airtable-token',
            ANTHROPIC_API_KEY: 'stub-anthropic-key',
            GOOGLE_SERVICE_ACCOUNT_JSON:
              '{"type":"service_account","project_id":"fixture-project"}',
            NCBI_API_KEY: 'stub-ncbi-key',
          },
          outputs: {
            files: [
              {
                path: 'files/fellows-previews.zip',
                sandboxPath: '/tmp/fellows-previews.zip',
                mimeType: 'application/zip',
              },
            ],
          },
        })
      )

      expect(response.status).toBe(200)
      await expect(response.clone().json()).resolves.toMatchObject({
        output: { cost: { input: 0, output: 0, total: 0.00034567 } },
      })
      const sandboxRequest = mockExecuteInSandbox.mock.calls[0][0]
      expect(sandboxRequest.code).toContain("['bq', 'query'")
      expect(sandboxRequest.code).toContain('__sim_exec_globals__["__name__"] = "__main__"')
      expect(sandboxRequest.sandboxId).toBe('fellows-sandbox')
      expect(sandboxRequest.outputSandboxPaths).toEqual(['/tmp/fellows-previews.zip'])
      expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: Buffer.from(archiveBase64, 'base64'),
          target: expect.objectContaining({ path: 'files/fellows-previews.zip' }),
        })
      )
    })

    it('retains Function-body return semantics for Python snippets', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true

      await POST(
        createMockRequest('POST', {
          code: 'value = 41\nreturn value + 1',
          language: 'python',
          workspaceId: 'workspace-1',
        })
      )

      const e2bCode = mockExecuteInSandbox.mock.calls[0][0].code as string
      expect(e2bCode).toContain('"outside function" not in str(__sim_compile_error__)')
      expect(e2bCode).toContain('__sim_result__ = __sim_exec_globals__["__sim_main__"]()')
    })

    it.each([
      { reason: 'timeout', status: 408, message: 'timed out' },
      { reason: 'user', status: 499, message: 'cancelled' },
    ])('keeps $reason aborts distinct', async ({ reason, status, message }) => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const controller = new AbortController()
      const req = new NextRequest('http://localhost:3000/internal/function-execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'print("running")',
          language: 'python',
          workspaceId: 'workspace-1',
          timeout: 30_000,
        }),
        signal: controller.signal,
      })
      mockExecuteInSandbox.mockImplementationOnce(async () => {
        controller.abort(new DOMException(reason, 'AbortError'))
        throw controller.signal.reason
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(status)
      expect(data.error).toContain(message)
    })

    it.each([
      {
        termination: 'timeout' as const,
        errorName: 'TimeoutError',
        status: 408,
        message: 'timed out',
      },
      {
        termination: 'cancelled' as const,
        errorName: 'AbortError',
        status: 499,
        message: 'cancelled',
      },
    ])(
      'classifies trusted isolated-vm $termination results consistently with remote runtimes',
      async ({ termination, errorName, status, message }) => {
        const partialStdout = `partial output before ${termination}`
        mockExecuteInIsolatedVM.mockResolvedValueOnce({
          result: null,
          stdout: partialStdout,
          error: { name: errorName, message: `${errorName} from isolated-vm` },
          termination,
        })

        const response = await POST(
          createMockRequest('POST', {
            code: 'return true',
            language: 'javascript',
            timeout: 30_000,
          })
        )
        const data = await response.json()

        expect(response.status).toBe(status)
        expect(data.error).toContain(message)
        expect(data.output.stdout).toBe(partialStdout)
      }
    )

    it.each(['TimeoutError', 'AbortError'])(
      'keeps a user-thrown %s as an ordinary code error',
      async (errorName) => {
        mockExecuteInIsolatedVM.mockResolvedValueOnce({
          result: null,
          stdout: 'partial output before user error',
          error: { name: errorName, message: `User threw ${errorName}` },
        })

        const response = await POST(
          createMockRequest('POST', {
            code: `const error = new Error('user error'); error.name = '${errorName}'; throw error`,
            language: 'javascript',
            timeout: 30_000,
          })
        )
        const data = await response.json()

        expect(response.status).toBe(422)
        expect(data.output.stdout).toBe('partial output before user error')
        expect(data.debug.errorType).toBe(errorName)
      }
    )

    it('enforces the explicit Function timeout with a server-owned abort signal', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockImplementationOnce(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )

      const response = await POST(
        createMockRequest('POST', {
          code: 'print("running")',
          language: 'python',
          workspaceId: 'workspace-1',
          timeout: 1,
        })
      )
      const data = await response.json()

      expect(response.status).toBe(408)
      expect(data.error).toContain('timed out after 1ms')
    })

    it('uses the remaining workflow deadline when no block timeout is supplied', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const remainingBudgetMs = 10 * 60_000
      const req = new NextRequest('http://localhost:3000/internal/function-execution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_EXECUTION_DEADLINE_HEADER]: String(Date.now() + remainingBudgetMs),
        },
        body: JSON.stringify({
          code: 'print("running")',
          language: 'python',
          workspaceId: 'workspace-1',
        }),
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const sandboxRequest = mockExecuteInSandbox.mock.calls[0][0]
      expect(sandboxRequest.timeoutMs).toBeGreaterThan(9 * 60_000)
      expect(sandboxRequest.timeoutMs).toBeLessThanOrEqual(remainingBudgetMs)
    })

    it('classifies a client abort at the propagated execution deadline as a timeout', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const controller = new AbortController()
      const req = new NextRequest('http://localhost:3000/internal/function-execution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_EXECUTION_DEADLINE_HEADER]: String(Date.now() - 1_000),
        },
        body: JSON.stringify({
          code: 'print("running")',
          language: 'python',
          workspaceId: 'workspace-1',
          timeout: 30_000,
        }),
        signal: controller.signal,
      })
      mockExecuteInSandbox.mockImplementationOnce(async (sandboxRequest) => {
        expect(sandboxRequest.timeoutMs).toBe(1)
        controller.abort(new DOMException('The operation was aborted.', 'AbortError'))
        throw controller.signal.reason
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(408)
      expect(data.error).toContain('timed out')
    })

    it('should return computed result for multi-line code', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 10, stdout: '' })

      const req = createMockRequest('POST', {
        code: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nreturn a + b + c + d;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output.result).toBe(10)
    })

    it.concurrent('should handle missing code parameter', async () => {
      const req = createMockRequest('POST', {
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
    })

    it.concurrent('should use default timeout when not provided', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('rejects large refs in runtimes without ref-native helpers', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const req = createMockRequest('POST', {
        code: 'echo "$__blockRef_0"',
        language: 'shell',
        contextVariables: {
          __blockRef_0: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_ABCDEFGHIJKL',
            kind: 'array',
            size: 12 * 1024 * 1024,
            executionId: 'execution-1',
          },
        },
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain(
        'Large execution values require the JavaScript isolated-vm runtime'
      )
    })

    it('registers manifest array read broker for isolated-vm execution', async () => {
      const req = createMockRequest('POST', {
        code: 'return await sim.values.readArray(__blockRef_0)',
        language: 'javascript',
        contextVariables: {
          __blockRef_0: {
            __simLargeArrayManifest: true,
            version: 2,
            kind: 'array',
            totalCount: 1,
            chunkCount: 1,
            byteSize: 16,
            chunks: [
              {
                ref: {
                  __simLargeValueRef: true,
                  version: 1,
                  id: 'lv_ABCDEFGHIJKL',
                  kind: 'array',
                  size: 16,
                  executionId: 'execution-1',
                },
                count: 1,
                byteSize: 16,
              },
            ],
            preview: [{ id: 1 }],
          },
        },
      })

      const response = await POST(req)
      const data = await response.json()
      const [, options] = mockExecuteInIsolatedVM.mock.calls.at(-1) ?? []

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(options?.brokers).toHaveProperty('sim.values.readArray')
    })
  })

  describe('Template Variable Resolution', () => {
    it('should resolve environment variables with {{var_name}} syntax', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'secret-key-123', stdout: '' })
      const req = createMockRequest(
        'POST',
        {
          code: 'return {{API_KEY}}',
          envVars: {
            API_KEY: 'secret-key-123',
          },
        },
        {
          'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
        }
      )

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it('keeps an exact-name/exact-value JavaScript secret out of source and returns its raw runtime value with private provenance', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'Test', stdout: '' })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{Test}}',
            language: 'javascript',
            envVars: { Test: 'Test' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      const data = await response.json()
      const [request] = mockExecuteInIsolatedVM.mock.calls.at(-1) ?? []
      const bindingEntries = Object.entries(request.contextVariables)

      expect(response.status).toBe(200)
      expect(request.code).not.toContain('Test')
      expect(request.code).not.toContain('{{Test}}')
      expect(request.code).not.toContain('__var_')
      expect(bindingEntries).toHaveLength(1)
      expect(bindingEntries[0]?.[0]).toMatch(/^__sim_code_\d+_binding_\d+$/)
      expect(bindingEntries[0]?.[1]).toBe('Test')
      expect(data.output.result).toBe('Test')
      expect(data.__resolvedSecretNames).toEqual(['Test'])
      expect(JSON.stringify(data)).not.toContain('__sim_code_')
      expect(JSON.stringify(data)).not.toContain('__var_')
    })

    it('keeps an exact-name/exact-value Python secret out of source and supplies it only through private runtime input', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteInSandbox.mockResolvedValueOnce({
        result: 'Test',
        stdout: '',
        sandboxId: 'test-sandbox-id',
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{Test}}',
            language: 'python',
            envVars: { Test: 'Test' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      const data = await response.json()
      const [request] = mockExecuteInSandbox.mock.calls.at(-1) ?? []
      const runtimeInput = request.privateInputs.find(
        (input: { environmentVariable: string }) =>
          input.environmentVariable === '__SIM_RUNTIME_PAYLOAD_PATH'
      )
      const runtimePayload = JSON.parse(runtimeInput?.content ?? '{}')
      const secretBinding = runtimePayload.contextVariables.find(
        (entry: { value?: unknown }) => entry.value === 'Test'
      )

      expect(response.status).toBe(200)
      expect(request.code).not.toContain('Test')
      expect(request.code).not.toContain('{{Test}}')
      expect(request.code).not.toContain('__var_')
      expect(runtimePayload.environmentVariables).toEqual({ Test: 'Test' })
      expect(secretBinding).toMatchObject({ kind: 'json', value: 'Test' })
      expect(secretBinding.name).toMatch(/^__sim_code_\d+_binding_\d+__$/)
      expect(request.code).toContain(secretBinding.name)
      expect(data.output.result).toBe('Test')
      expect(data.__resolvedSecretNames).toEqual(['Test'])
      expect(JSON.stringify(data)).not.toContain('__sim_code_')
      expect(JSON.stringify(data)).not.toContain('__var_')
    })

    it('compiles legacy bare and quoted Custom Tool placeholders into opaque VM bindings', async () => {
      const secret = 'quote" slash\\ newline\n{{OTHER}} true 123'
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: [secret, secret, `Bearer ${secret}`],
        stdout: '',
      })
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: [
              'const bare = {{API_KEY}}',
              'const quoted = "{{API_KEY}}"',
              'return [bare, quoted, "Bearer {{API_KEY}}"]',
            ].join('\n'),
            isCustomTool: true,
            envVars: { API_KEY: secret, OTHER: 'must-not-resolve' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      const [request] = mockExecuteInIsolatedVM.mock.calls.at(-1) ?? []
      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual(['API_KEY'])
      expect(request.code).not.toContain(secret)
      expect(request.code).not.toContain('__var_')
      expect(request.code).toContain('__sim_code_')
      expect(request.code).not.toContain('globalThis[')
      expect(Object.values(request.contextVariables)).toContain(secret)
      expect(Object.keys(request.contextVariables)).not.toContain('API_KEY')
    })

    it('installs regex constructors as opaque runtime bindings before isolated user code', async () => {
      const response = await POST(
        createMockRequest('POST', {
          code: [
            'RegExp.prototype.constructor = null',
            'return /^{{PATTERN}}$/.test("candidate")',
          ].join('\n'),
          envVars: { PATTERN: 'secret' },
        })
      )

      const [request] = mockExecuteInIsolatedVM.mock.calls.at(-1) ?? []
      const [runtimeBinding] = request.runtimeBindings
      expect(response.status).toBe(200)
      expect(runtimeBinding.kind).toBe('javascript-runtime')
      expect(request.code).toContain(`new ${runtimeBinding.name}.RegExp`)
      expect(request.code).not.toContain('secret')
    })

    it('captures regex constructors in the remote preload before static imports execute', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const response = await POST(
        createMockRequest('POST', {
          code: ['import "side-effect-module"', 'return /^{{PATTERN}}$/.test("candidate")'].join(
            '\n'
          ),
          language: 'javascript',
          envVars: { PATTERN: 'secret' },
        })
      )

      const [sandboxRequest] = mockExecuteInSandbox.mock.calls.at(-1) ?? []
      const runtimeBindingName = /new (__sim_code_\d+_runtime_\d+)\.RegExp/.exec(
        sandboxRequest.code
      )?.[1]
      expect(response.status).toBe(200)
      expect(runtimeBindingName).toBeDefined()
      expect(sandboxRequest.runtimeBindings).toContainEqual({
        name: runtimeBindingName,
        kind: 'javascript-runtime',
      })
      expect(JSON.stringify(sandboxRequest.runtimeBindings)).not.toContain('secret')
    })

    it('allocates remote runtime helpers against decoded JavaScript identifiers', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const escapedAlias = String.raw`\u005f\u005fsim_runtime_read_0`

      const response = await POST(
        createMockRequest('POST', {
          code: [
            `import { basename as ${escapedAlias} } from "node:path"`,
            `return ["{{KEY}}", ${escapedAlias}("/tmp/file.txt")]`,
          ].join('\n'),
          language: 'javascript',
          envVars: { KEY: 'secret' },
        })
      )

      const [sandboxRequest] = mockExecuteInSandbox.mock.calls.at(-1) ?? []
      const syntaxCheck = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        encoding: 'utf8',
        input: sandboxRequest.code,
      })
      expect(response.status).toBe(200)
      expect(sandboxRequest.code).toContain('readFileSync as __sim_runtime_read_1')
      expect(sandboxRequest.code).not.toContain('readFileSync as __sim_runtime_read_0')
      expect(syntaxCheck.stderr).toBe('')
      expect(syntaxCheck.status).toBe(0)
    })

    it('keeps comments and missing placeholders unchanged without secret provenance', async () => {
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: '// {{COMMENT_ONLY}}\nreturn "{{MISSING}}"',
            envVars: { COMMENT_ONLY: 'must-not-bind' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      const [request] = mockExecuteInIsolatedVM.mock.calls.at(-1) ?? []
      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual([])
      expect(request.code).toContain('// {{COMMENT_ONLY}}')
      expect(request.code).toContain('"{{MISSING}}"')
      expect(Object.values(request.contextVariables)).not.toContain('must-not-bind')
    })

    it('does not infer provenance from an unused low-entropy environment value', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'Box eSign', stdout: '' })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return "Box eSign"',
            envVars: { SERVICENOW_PASSWORD: 'x' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.output.result).toBe('Box eSign')
      expect(data.__resolvedSecretNames).toEqual([])
    })

    it('does not build provenance matchers for unused oversized environment values', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'safe', stdout: '' })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return "safe"',
            envVars: { UNUSED: 'x'.repeat(65 * 1024) },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual([])
    })

    it('conservatively reports only compiled secrets when bounded output classification is exceeded', async () => {
      const result = Array.from({ length: 100_001 }, () => 'ordinary')
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result, stdout: '' })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'const key = {{API_KEY}}; return params.items',
            params: { items: result },
            envVars: { API_KEY: 'secret-value', UNUSED: 'x' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(response.headers.get('x-sim-private-tool-metadata')).toBe('resolved-secret-names-v1')
      expect(data.output.result).toHaveLength(100_001)
      expect(data.output.result[0]).toBe('ordinary')
      expect(data.__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it('conservatively reports a compiled secret whose value exceeds matcher capacity', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'ordinary', stdout: '' })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'const key = {{OVERSIZED_SECRET}}; return "ordinary"',
            envVars: { OVERSIZED_SECRET: 's'.repeat(64 * 1024 + 1), UNUSED: 'x' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.output.result).toBe('ordinary')
      expect(data.__resolvedSecretNames).toEqual(['OVERSIZED_SECRET'])
    })

    it('tracks only compiled names when configured secrets share the same value', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'true', stdout: '' })
      const oneResponse = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{SECOND}}',
            envVars: { FIRST: 'true', SECOND: 'true' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'true', stdout: '' })
      const bothResponse = await POST(
        createMockRequest(
          'POST',
          {
            code: 'const first = {{FIRST}}; return {{SECOND}}',
            envVars: { FIRST: 'true', SECOND: 'true' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      expect((await oneResponse.json()).__resolvedSecretNames).toEqual(['SECOND'])
      expect((await bothResponse.json()).__resolvedSecretNames).toEqual(['FIRST', 'SECOND'])
    })

    it('lowers missing shell placeholders while preserving comments and heredoc delimiters', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: [
              '# {{COMMENT_ONLY}}',
              'printf \'%s\\n\' "before{{MISSING}}after"',
              "cat <<'{{DELIMITER}}'",
              'literal body',
              '{{DELIMITER}}',
            ].join('\n'),
            language: 'shell',
            envVars: { COMMENT_ONLY: 'must-not-bind' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      const [request] = mockExecuteShellInSandbox.mock.calls.at(-1) ?? []
      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual([])
      expect(request.code).toContain('# {{COMMENT_ONLY}}')
      expect(request.code).toContain('"beforeafter"')
      expect(request.code).toContain("cat <<'{{DELIMITER}}'")
      expect(request.code).toContain('\n{{DELIMITER}}')
      expect(request.code).not.toContain('{{MISSING}}')
    })

    it.each([
      {
        language: 'javascript',
        code: 'import path from "node:path"\nreturn "{{API_KEY}}"',
      },
      { language: 'python', code: 'return "{{API_KEY}}"' },
    ])(
      'keeps $language runtime values out of remote generated source',
      async ({ language, code }) => {
        envFlagsMock.isRemoteSandboxEnabled = true
        const secret = 'remote"\\\nsecret'

        const response = await POST(
          createMockRequest('POST', {
            code,
            language,
            envVars: { API_KEY: secret },
            params: { input: 'value' },
            contextVariables: { __blockRef_0: 'context' },
          })
        )

        const [sandboxRequest] = mockExecuteInSandbox.mock.calls.at(-1) ?? []
        expect(response.status).toBe(200)
        expect(sandboxRequest.code).not.toContain(secret)
        expect(sandboxRequest.code).not.toContain('__var_')
        expect(sandboxRequest.privateInputs).toHaveLength(1)
        const payload = JSON.parse(sandboxRequest.privateInputs[0].content)
        expect(payload.environmentVariables.API_KEY).toBe(secret)
        expect(payload.params.input).toBe('value')
        expect(payload.contextVariables).toContainEqual({
          name: '__blockRef_0',
          kind: 'json',
          value: 'context',
        })
      }
    )

    it('routes quoted shell heredocs through private sandbox input files', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const secret = 'shell"\\\n{{OTHER}}'
      mockExecuteShellInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: `Bearer ${secret}\n$UNRELATED \`touch /tmp/nope\``,
        sandboxId: 'test-shell-sandbox-id',
      })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: [
              "cat <<'PAYLOAD'",
              'Bearer {{API_KEY}}',
              '$UNRELATED `touch /tmp/nope`',
              'PAYLOAD',
            ].join('\n'),
            language: 'shell',
            envVars: { API_KEY: secret, OTHER: 'must-not-resolve' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      const [sandboxRequest] = mockExecuteShellInSandbox.mock.calls.at(-1) ?? []
      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual(['API_KEY'])
      expect(sandboxRequest.code).not.toContain(secret)
      expect(sandboxRequest.code).not.toContain('$UNRELATED')
      expect(sandboxRequest.privateInputs).toHaveLength(1)
      expect(sandboxRequest.privateInputs[0].content).toContain(secret)
      expect(sandboxRequest.privateInputs[0].content).toContain('$UNRELATED `touch /tmp/nope`')
    })

    /**
     * The founding scenario of the usage trail: code that reads a secret and emits it only in
     * transformed form. No output ever matches the value, so an output-gated report said
     * "never used" for exactly the run an admin needs to see. A referenced secret reports
     * whether or not its value surfaces.
     */
    it('reports a secret exfiltrated character by character', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: 's|e|c|r|e|t|-|v|a|l|u|e|-|1|2|3|4',
        stdout: '',
      })
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: "const k = '{{API_KEY}}'; return k.split('').join('|')",
            envVars: { API_KEY: 'secret-value-1234' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual(['API_KEY'])
    })

    /** The ordinary silent use: the key authenticates a call and never appears in output. */
    it('reports a secret used without appearing in the output', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: { status: 200 }, stdout: '' })
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: "await fetch('https://api.example.com', { headers: { auth: environmentVariables['API_KEY'] } }); return { status: 200 }",
            envVars: { API_KEY: 'secret-value-1234' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it('does not report a reference when validation rejects before code resolution', async () => {
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{API_KEY}}',
            envVars: { API_KEY: 'secret-value' },
            outputs: {
              files: Array.from({ length: 21 }, (_, index) => ({
                path: `files/output-${index}.json`,
                sandboxPath: `/home/user/output-${index}.json`,
              })),
            },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Too many sandbox output files requested')
      expect(data.__resolvedSecretNames).toEqual([])
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    })

    /**
     * A direct read is a factual reference to the environment binding, not the value-coincidence
     * inference #6374 removed — that one claimed a secret because its plaintext happened to equal
     * an unrelated output. Reporting it is what activates execution-log masking for the value.
     */
    it('reports secrets reached through placeholders and through direct environment reads', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: 'secret-valueother-secret',
        stdout: '',
      })
      const envResponse = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{SHARED}} + {{ENV_ONLY}} + {{MISSING}}',
            params: { SHARED: 'param-value', MISSING: 'ordinary-param' },
            envVars: { SHARED: 'secret-value', ENV_ONLY: 'other-secret' },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )
      const envData = await envResponse.json()

      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'secret-value', stdout: '' })
      const directResponse = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return environmentVariables.API_KEY + params.API_KEY',
            params: { API_KEY: 'ordinary-param' },
            envVars: { API_KEY: 'secret-value' },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )
      const directData = await directResponse.json()

      expect(envData.__resolvedSecretNames).toEqual(['ENV_ONLY', 'SHARED'])
      expect(directData.output.result).toBe('secret-value')
      expect(directData.__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it.each([
      { name: 'numeric', secret: '123', result: 123 },
      { name: 'boolean', secret: 'true', result: true },
    ])(
      'preserves a typed $name value returned through a direct environment read while reporting it',
      async ({ secret, result }) => {
        mockExecuteInIsolatedVM.mockResolvedValueOnce({ result, stdout: '' })

        const response = await POST(
          createMockRequest(
            'POST',
            {
              code: 'return environmentVariables.API_KEY',
              envVars: { API_KEY: secret },
            },
            {
              'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
            }
          )
        )
        const data = await response.json()

        /** The typed value survives: a secret this short is never substitutable. */
        expect(data.output.result).toBe(result)
        expect(data.__resolvedSecretNames).toEqual(['API_KEY'])
      }
    )

    it('reports placeholder output and a shell environment expansion alike', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      mockExecuteShellInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: 'secret-value',
        sandboxId: 'test-shell-sandbox-id',
      })

      const referencedResponse = await POST(
        createMockRequest(
          'POST',
          {
            code: 'printf "%s" "{{API_KEY}}"',
            language: 'shell',
            envVars: { API_KEY: 'secret-value' },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )
      const referencedData = await referencedResponse.json()

      mockExecuteShellInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: 'secret-value',
        sandboxId: 'test-shell-sandbox-id',
      })
      const directResponse = await POST(
        createMockRequest(
          'POST',
          {
            code: 'printf "%s" "$API_KEY"',
            language: 'shell',
            envVars: { API_KEY: 'secret-value' },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )
      const directData = await directResponse.json()

      expect(referencedData.__resolvedSecretNames).toEqual(['API_KEY'])
      expect(directData.output.stdout).toBe('secret-value')
      expect(directData.__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it('returns nonzero shell stderr as a visible 422 error and diagnostic output', async () => {
      envFlagsMock.isRemoteSandboxEnabled = true
      const stderr = "error: unknown flag: --short\nSee 'kubectl version --help' for usage."
      mockExecuteShellInSandbox.mockResolvedValueOnce({
        result: null,
        stdout: stderr,
        error: stderr,
        sandboxId: 'test-shell-sandbox-id',
      })

      const response = await POST(
        createMockRequest('POST', {
          code: 'kubectl version --client --short',
          language: 'shell',
        })
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data).toMatchObject({
        success: false,
        error: stderr,
        output: { result: null, stdout: stderr },
      })
    })

    it('keeps execution available when the scoped catalog exceeds provenance matcher bounds', async () => {
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return "ok"',
            envVars: { OVERSIZED_SECRET: 's'.repeat(64 * 1024 + 1) },
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )

      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual([])
      expect(response.headers.get('x-sim-private-tool-metadata')).toBe('resolved-secret-names-v1')
      expect(mockExecuteInIsolatedVM).toHaveBeenCalled()
    })

    it('reports only substitutions allowed by the Function secret scope', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'allowed-secret', stdout: '' })
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return {{ALLOWED}} + {{BLOCKED}}',
            envVars: { ALLOWED: 'allowed-secret', BLOCKED: 'blocked-secret' },
            secretScope: 'selected',
            mountedSecrets: ['ALLOWED'],
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )

      expect((await response.json()).__resolvedSecretNames).toEqual(['ALLOWED'])
    })

    it('resolves a selected __proto__ secret as an own environment key', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'secret-value', stdout: '' })
      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'return "{{__proto__}}"',
            envVars: Object.fromEntries([['__proto__', 'secret-value']]),
            secretScope: 'selected',
            mountedSecrets: ['__proto__'],
          },
          {
            'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1',
          }
        )
      )

      expect(response.status).toBe(200)
      expect((await response.json()).__resolvedSecretNames).toEqual(['__proto__'])
    })

    /**
     * Previously asserted the inverse: a referenced secret whose value stayed out of the
     * result reported nothing. That gate made the trail miss silent use — the ordinary
     * API-call case and the transformed-exfiltration case alike — so activation now follows
     * the referenced set. The value never appearing costs nothing downstream; the masking
     * matcher simply never fires on it.
     */
    it('activates a referenced secret even when its value never crosses the result', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: 'safe-result', stdout: '' })

      const response = await POST(
        createMockRequest(
          'POST',
          {
            code: 'const key = {{API_KEY}}; return "safe-result"',
            envVars: { API_KEY: 'secret-value' },
          },
          { 'x-sim-request-private-tool-metadata': 'resolved-secret-names-v1' }
        )
      )

      expect((await response.json()).__resolvedSecretNames).toEqual(['API_KEY'])
    })

    it.concurrent('should resolve tag variables with <tag_name> syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return <email>',
        blockData: {
          'block-123': { id: '123', subject: 'Test Email' },
        },
        blockNameMapping: {
          email: 'block-123',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should NOT treat email addresses as template variables', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Email sent to user"',
        params: {
          email: {
            from: 'Dr. Shaw <shaw@high-flying.ai>',
            to: 'User <user@example.com>',
          },
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should only match valid variable names in angle brackets', async () => {
      const req = createMockRequest('POST', {
        code: 'return <validVar> + "<invalid@email.com>" + <another_valid>',
        blockData: {
          'block-1': 'hello',
          'block-2': 'world',
        },
        blockNameMapping: {
          validvar: 'block-1',
          another_valid: 'block-2',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Gmail Email Data Handling', () => {
    it.concurrent(
      'should handle Gmail webhook data with email addresses containing angle brackets',
      async () => {
        const emailData = {
          id: '123',
          from: 'Dr. Shaw <shaw@high-flying.ai>',
          to: 'User <user@example.com>',
          subject: 'Test Email',
          bodyText: 'Hello world',
        }

        const req = createMockRequest('POST', {
          code: 'return <email>',
          blockData: {
            'block-email': emailData,
          },
          blockNameMapping: {
            email: 'block-email',
          },
        })

        const response = await POST(req)

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.success).toBe(true)
      }
    )

    it.concurrent(
      'should properly serialize complex email objects with special characters',
      async () => {
        const emailData = {
          from: 'Test User <test@example.com>',
          bodyHtml: '<div>HTML content with "quotes" and \'apostrophes\'</div>',
          bodyText: 'Text with\nnewlines\tand\ttabs',
        }

        const req = createMockRequest('POST', {
          code: 'return <email>',
          blockData: {
            'block-email': emailData,
          },
          blockNameMapping: {
            email: 'block-email',
          },
        })

        const response = await POST(req)

        expect(response.status).toBe(200)
      }
    )
  })

  describe('Custom Tools', () => {
    it.concurrent('should handle custom tool execution with direct parameter access', async () => {
      const req = createMockRequest('POST', {
        code: 'return location + " weather is sunny"',
        params: {
          location: 'San Francisco',
        },
        isCustomTool: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Security and Edge Cases', () => {
    it.concurrent('should handle malformed JSON in request body', async () => {
      const req = new NextRequest('http://localhost:3000/internal/function-execution', {
        method: 'POST',
        body: 'invalid json{',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
    })

    it.concurrent('should handle timeout parameter', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        timeout: 10000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockExecuteInIsolatedVM).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 10000 }),
        expect.any(Object)
      )
    })

    it.concurrent('should handle empty parameters object', async () => {
      const req = createMockRequest('POST', {
        code: 'return "no params"',
        params: {},
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Enhanced Error Handling', () => {
    it('should provide detailed syntax error with line content', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: null,
        stdout: '',
        error: { message: 'Unexpected end of input', name: 'SyntaxError' },
      })

      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test",\n  description: "This has a missing closing quote\n};\nreturn obj;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toBeTruthy()
    })

    it('should provide detailed runtime error with line and column', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: null,
        stdout: '',
        error: {
          message: "Cannot read properties of null (reading 'someMethod')",
          name: 'TypeError',
        },
      })

      const req = createMockRequest('POST', {
        code: 'const obj = null;\nreturn obj.someMethod();',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Type Error')
      expect(data.error).toContain('Cannot read properties of null')
    })

    it('should handle ReferenceError with enhanced details', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: null,
        stdout: '',
        error: { message: 'undefinedVariable is not defined', name: 'ReferenceError' },
      })

      const req = createMockRequest('POST', {
        code: 'const x = 42;\nreturn undefinedVariable + x;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Reference Error')
      expect(data.error).toContain('undefinedVariable is not defined')
    })

    it('should show original source code when resolved block references cause syntax errors', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: null,
        stdout: '',
        error: {
          message: 'Unexpected identifier "globalThis"',
          name: 'SyntaxError',
          line: 1,
          column: 7,
          lineContent: 'retur globalThis["__blockRef_0"]',
        },
      })

      const req = createMockRequest('POST', {
        code: 'retur globalThis["__blockRef_0"]',
        sourceCode: 'retur <start.reqerror>',
        contextVariables: { __blockRef_0: 'value' },
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Line 1: `retur <start.reqerror>`')
      expect(data.error).not.toContain('globalThis')
      expect(data.debug.lineContent).toBe('retur <start.reqerror>')
    })

    it('should handle thrown errors gracefully', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: null,
        stdout: '',
        error: { message: 'Custom error message', name: 'Error' },
      })

      const req = createMockRequest('POST', {
        code: 'throw new Error("Custom error message");',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Custom error message')
    })

    it('should provide helpful suggestions for common syntax errors', async () => {
      mockExecuteInIsolatedVM.mockResolvedValueOnce({
        result: null,
        stdout: '',
        error: { message: 'Unexpected end of input', name: 'SyntaxError' },
      })

      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test"\n// Missing closing brace',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toBeTruthy()
    })
  })

  describe('Utility Functions', () => {
    it.concurrent('should properly escape regex special characters', async () => {
      const req = createMockRequest('POST', {
        code: 'return {{special.chars+*?}}',
        envVars: {
          'special.chars+*?': 'escaped-value',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should handle JSON serialization edge cases', async () => {
      const complexData = {
        special: 'chars"with\'quotes',
        unicode: '🎉 Unicode content',
        nested: {
          deep: {
            value: 'test',
          },
        },
      }

      const req = createMockRequest('POST', {
        code: 'return <complexData>',
        blockData: {
          'block-complex': complexData,
        },
        blockNameMapping: {
          complexdata: 'block-complex',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })
})
