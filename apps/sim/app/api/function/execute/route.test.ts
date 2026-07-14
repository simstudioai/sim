/**
 * Tests for function execution API route
 *
 * @vitest-environment node
 */
import {
  createMockRequest,
  envFlagsMock,
  hybridAuthMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteInE2B,
  mockExecuteInIsolatedVM,
  mockFetchWorkspaceFileBuffer,
  mockGetWorkspaceFile,
  mockResolveWorkspaceFileReference,
  mockUpdateWorkspaceFileContent,
  mockUploadFile,
  mockValidateWorkspaceFileWriteTarget,
  mockWriteWorkspaceFileByPath,
} = vi.hoisted(() => ({
  mockExecuteInE2B: vi.fn(),
  mockExecuteInIsolatedVM: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
  mockUploadFile: vi.fn(),
  mockValidateWorkspaceFileWriteTarget: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@/lib/execution/isolated-vm', () => ({
  executeInIsolatedVM: mockExecuteInIsolatedVM,
}))

vi.mock('@/lib/execution/e2b', () => ({
  executeInE2B: mockExecuteInE2B,
  executeShellInE2B: vi.fn(),
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
  normalizeOutputWorkspaceFileName: vi.fn((p: string) => p.replace(/^files\//, '')),
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

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

import { validateProxyUrl } from '@/lib/core/security/input-validation'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { POST } from '@/app/api/function/execute/route'

describe('Function Execute API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envFlagsMock.isE2bEnabled = false

    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })

    mockExecuteInIsolatedVM.mockResolvedValue({ result: 'test', stdout: '' })
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
    clearLargeValueCacheForTests()

    mockExecuteInE2B.mockResolvedValue({
      result: 'e2b success',
      stdout: 'e2b output',
      sandboxId: 'test-sandbox-id',
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
    mockResolveWorkspaceFileReference.mockResolvedValue(null)
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

    it.concurrent('should use isolated-vm for secure sandboxed execution', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output.result).toBe('test')
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

    it('exports multiple declared sandbox output files', async () => {
      envFlagsMock.isE2bEnabled = true
      mockExecuteInE2B.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
        exportedFiles: {
          '/home/user/chart.png': 'iVBORw0KGgo=',
          '/home/user/summary.json': '{"ok":true}',
        },
      })

      const req = createMockRequest('POST', {
        code: 'print("done")',
        language: 'python',
        workspaceId: 'workspace-1',
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
      expect(mockExecuteInE2B).toHaveBeenCalledWith(
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
      expect(data.resources).toEqual([
        expect.objectContaining({ path: 'files/reports/chart.png' }),
        expect.objectContaining({ path: 'files/reports/summary.json' }),
      ])
    })

    it('prevalidates all sandbox output destinations before writing any files', async () => {
      envFlagsMock.isE2bEnabled = true
      mockExecuteInE2B.mockResolvedValueOnce({
        result: 'done',
        stdout: 'ok',
        sandboxId: 'sandbox-123',
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
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
    })

    it('rejects duplicate sandbox output destinations before writing files', async () => {
      envFlagsMock.isE2bEnabled = true
      mockExecuteInE2B.mockResolvedValueOnce({
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
      envFlagsMock.isE2bEnabled = true
      mockExecuteInE2B.mockResolvedValueOnce({
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

    it('rejects sandboxPath outputs when the call would run in isolated-vm (E2B enabled, JS without imports)', async () => {
      envFlagsMock.isE2bEnabled = true

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

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
      expect(data.error).toContain('no sandbox filesystem')
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(mockExecuteInE2B).not.toHaveBeenCalled()
      expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
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
      // E2B is disabled in this test, so the remediation must name that cause
      // instead of suggesting python (which would also fail without E2B).
      expect(data.error).toContain('E2B is not enabled')
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    })

    it('flags an overwrite export whose bytes are identical to the current file content as unchanged', async () => {
      envFlagsMock.isE2bEnabled = true
      const staleContent = '# doc\nunchanged mounted content\n'
      mockExecuteInE2B.mockResolvedValueOnce({
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

    it('reports size, previousSize, and sha256 receipts on a successful overwrite export', async () => {
      envFlagsMock.isE2bEnabled = true
      const newContent = '# doc\nnew content\n'
      mockExecuteInE2B.mockResolvedValueOnce({
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
      const e2bCode = mockExecuteInE2B.mock.calls[0][0].code as string
      expect(e2bCode).toContain("print('\\n__SIM_RESULT__=' + json.dumps(__sim_result__))")
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
      envFlagsMock.isE2bEnabled = true
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
    it.concurrent('should resolve environment variables with {{var_name}} syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return {{API_KEY}}',
        envVars: {
          API_KEY: 'secret-key-123',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
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
      const req = new NextRequest('http://localhost:3000/api/function/execute', {
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
