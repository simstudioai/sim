/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getE2BDocFormat: vi.fn(),
  getFile: vi.fn(),
  loadContext: vi.fn(),
  resolvePermission: vi.fn(),
  fetchBuffer: vi.fn(),
  runE2BCompiledCheck: vi.fn(),
  runSandboxTask: vi.fn(),
  validateMermaidSource: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  getE2BDocFormat: mocks.getE2BDocFormat,
}))

vi.mock('@/lib/copilot/tools/server/files/doc-recalc', () => ({
  runE2BCompiledCheck: mocks.runE2BCompiledCheck,
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isDocSandboxEnabled: true }))

vi.mock('@/lib/execution/constants', () => ({
  BINARY_DOC_TASKS: { pptx: 'document-pptx' },
  MAX_DOCUMENT_PREVIEW_CODE_BYTES: 1_000,
}))

vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: mocks.runSandboxTask,
  SandboxUserCodeError: class SandboxUserCodeError extends Error {
    constructor(message: string, name: string) {
      super(message)
      this.name = name
    }
  },
}))

vi.mock('@/lib/mermaid/validate', () => ({
  validateMermaidSource: mocks.validateMermaidSource,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  getWorkspaceFile: mocks.getFile,
}))

import { SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { compiledCheckWorkspaceFile } from '@/lib/workspace-files/application/compiled-check-workspace-file'

const sessionPrincipal = {
  kind: 'session' as const,
  userId: 'current-user',
  sessionId: 'session-1',
}

function mockFile(name: string) {
  mocks.getFile.mockResolvedValue({
    id: 'file-1',
    workspaceId: 'workspace-1',
    name,
    size: 20,
    uploadedBy: 'original-uploader',
  })
  mocks.fetchBuffer.mockResolvedValue(Buffer.from('source code'))
}

describe('compiledCheckWorkspaceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getE2BDocFormat.mockResolvedValue(null)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadContext.mockResolvedValue({
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
      billedAccountUserId: 'billing-owner',
    })
    mocks.runSandboxTask.mockResolvedValue(Buffer.from('compiled'))
  })

  it('rejects API-key principals before canonical loading or business execution', async () => {
    const unsupportedPrincipals = [
      { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key' },
      {
        kind: 'workspace_api_key' as const,
        workspaceId: 'workspace-1',
        keyId: 'workspace-key',
      },
    ]

    /**
     * A workspace key is refused with the code naming *why* — the operation
     * denies workspace keys, so the remedy is a personal key — while any other
     * disallowed kind gets the generic kind refusal.
     */
    const expectedDetailCode = {
      personal_api_key: 'PRINCIPAL_KIND_NOT_PERMITTED',
      workspace_api_key: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED',
    } as const

    for (const principal of unsupportedPrincipals) {
      await expect(
        compiledCheckWorkspaceFile.execute({
          principal,
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
        })
      ).rejects.toMatchObject({
        code: 'forbidden',
        detailCode: expectedDetailCode[principal.kind],
      })
    }

    expect(compiledCheckWorkspaceFile.operation).toMatchObject({
      id: 'files.compiled_check',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
    })
    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })

  it('uses the current session user as the legacy sandbox owner, never the uploader', async () => {
    mockFile('report.pptx')

    await expect(
      compiledCheckWorkspaceFile.execute({
        principal: sessionPrincipal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ ok: true })

    expect(mocks.runSandboxTask).toHaveBeenCalledWith(
      'document-pptx',
      { code: 'source code', workspaceId: 'workspace-1' },
      { ownerKey: 'user:current-user' }
    )
    expect(mocks.runSandboxTask).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      ownerKey: 'user:original-uploader',
    })
    expect(mocks.loadContext).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
    expect(mocks.getFile).toHaveBeenCalledTimes(1)
    expect(mocks.fetchBuffer).toHaveBeenCalledTimes(1)
  })

  it('preserves legacy sandbox user-code failures in the successful response envelope', async () => {
    mockFile('report.pptx')
    mocks.runSandboxTask.mockRejectedValue(
      new SandboxUserCodeError('Presentation source is invalid', 'SyntaxError')
    )

    await expect(
      compiledCheckWorkspaceFile.execute({
        principal: sessionPrincipal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Presentation source is invalid',
      errorName: 'SyntaxError',
    })
  })

  it('keeps Mermaid validation on the in-process path', async () => {
    mockFile('diagram.mmd')
    mocks.validateMermaidSource.mockResolvedValue({
      ok: false,
      error: 'Unexpected token',
      errorName: 'MermaidError',
    })

    await expect(
      compiledCheckWorkspaceFile.execute({
        principal: sessionPrincipal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Unexpected token',
      errorName: 'MermaidError',
    })

    expect(mocks.validateMermaidSource).toHaveBeenCalledWith('source code')
    expect(mocks.runE2BCompiledCheck).not.toHaveBeenCalled()
    expect(mocks.runSandboxTask).not.toHaveBeenCalled()
  })

  it('keeps E2B user-code failures in the successful response envelope', async () => {
    mockFile('report.pptx')
    mocks.getE2BDocFormat.mockResolvedValue({ ext: 'pptx' })
    mocks.runE2BCompiledCheck.mockResolvedValue({ ok: false, error: 'Script failed' })

    await expect(
      compiledCheckWorkspaceFile.execute({
        principal: sessionPrincipal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Script failed',
      errorName: 'CompiledCheckError',
    })

    expect(mocks.runE2BCompiledCheck).toHaveBeenCalledWith({
      source: 'source code',
      fileName: 'report.pptx',
      workspaceId: 'workspace-1',
      ext: 'pptx',
      principal: sessionPrincipal,
    })
    expect(mocks.runSandboxTask).not.toHaveBeenCalled()
  })

  it('propagates E2B infrastructure failures', async () => {
    mockFile('report.pptx')
    mocks.getE2BDocFormat.mockResolvedValue({ ext: 'pptx' })
    const failure = new Error('E2B unavailable')
    mocks.runE2BCompiledCheck.mockRejectedValue(failure)

    await expect(
      compiledCheckWorkspaceFile.execute({
        principal: sessionPrincipal,
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)

    expect(mocks.runSandboxTask).not.toHaveBeenCalled()
  })
})
