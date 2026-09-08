/**
 * @vitest-environment node
 */

import { encryptionMock, encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_SECRET_PROVENANCE_FIELD,
} from '@/lib/execution/private-tool-metadata'

const {
  mockGetTableById,
  mockListTables,
  mockGetOrCreateTableSnapshot,
  mockDownloadFile,
  mockGeneratePresignedDownloadUrl,
  mockHasCloudStorage,
  mockExecuteTool,
  mockListWorkspaceFiles,
  mockFindWorkspaceFileRecord,
  mockFetchWorkspaceFileBuffer,
  mockFetchServableWorkspaceFileBuffer,
  mockGetSandboxWorkspaceFilePath,
  mockListWorkspaceFileFolders,
  mockListAllWorkspaceFiles,
  mockListWorkspaceFileFoldersOperation,
  mockDownloadWorkspaceFileRecord,
  mockReadWorkspaceFileContent,
  mockMaterializeCopilotCodeSecrets,
  mockHasWorkspaceSandboxAccess,
  mockImportWorkspaceFileSecretProvenanceForRuntime,
  mockGetTableSnapshotModelMountSafety,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockListTables: vi.fn(),
  mockGetOrCreateTableSnapshot: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockFindWorkspaceFileRecord: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockFetchServableWorkspaceFileBuffer: vi.fn(),
  mockGetSandboxWorkspaceFilePath: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockListAllWorkspaceFiles: vi.fn(),
  mockListWorkspaceFileFoldersOperation: vi.fn(),
  mockDownloadWorkspaceFileRecord: vi.fn(),
  mockReadWorkspaceFileContent: vi.fn(),
  mockMaterializeCopilotCodeSecrets: vi.fn(),
  mockHasWorkspaceSandboxAccess: vi.fn(),
  mockImportWorkspaceFileSecretProvenanceForRuntime: vi.fn(),
  mockGetTableSnapshotModelMountSafety: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
  listTables: mockListTables,
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  getTableSnapshotModelMountSafety: mockGetTableSnapshotModelMountSafety,
}))
vi.mock('@/lib/table/snapshot-cache', () => ({
  getOrCreateTableSnapshot: mockGetOrCreateTableSnapshot,
  SNAPSHOT_MAX_BYTES: 500 * 1024 * 1024,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
  hasCloudStorage: mockHasCloudStorage,
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
  findWorkspaceFileRecord: mockFindWorkspaceFileRecord,
  getSandboxWorkspaceFilePath: mockGetSandboxWorkspaceFilePath,
  listWorkspaceFiles: mockListWorkspaceFiles,
}))
vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: mockFetchServableWorkspaceFileBuffer,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  listWorkspaceFileFolders: mockListWorkspaceFileFolders,
}))
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: { execute: mockListAllWorkspaceFiles },
}))
vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  listWorkspaceFileFoldersOperation: { execute: mockListWorkspaceFileFoldersOperation },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-record', () => ({
  downloadWorkspaceFileRecord: { execute: mockDownloadWorkspaceFileRecord },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: mockReadWorkspaceFileContent },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  importWorkspaceFileSecretProvenanceForRuntime: mockImportWorkspaceFileSecretProvenanceForRuntime,
}))
vi.mock('@/lib/copilot/vfs/path-utils', () => ({
  decodeVfsPathSegments: (p: string) => p.split('/'),
  encodeVfsPathSegments: (s: string[]) => s.join('/'),
}))
vi.mock('@/lib/copilot/tools/secret-mount-materializer.server', () => ({
  CopilotCodeSecretAccessError: class CopilotCodeSecretAccessError extends Error {},
  materializeCopilotCodeSecrets: mockMaterializeCopilotCodeSecrets,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: mockHasWorkspaceSandboxAccess,
}))
vi.mock('@/lib/execution/remote-sandbox/entitlement', () => ({
  MAX_PLAN_REQUIRED: 'Sim sandboxes require an active Max or Enterprise plan.',
}))

import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import { executeFunctionExecute } from '@/lib/copilot/tools/handlers/function-execute'
import { executeRunCode } from '@/lib/copilot/tools/handlers/run-code'
import { SNAPSHOT_MAX_BYTES } from '@/lib/table/snapshot-cache'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const table = {
  id: 'tbl_1',
  workspaceId: 'ws_1',
  rowCount: 1,
  schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
}

const context = {
  workspaceId: 'ws_1',
  userId: 'u1',
  copilotToolExecution: true,
  toolCallId: 'function-execute-test',
}

function mountedFiles() {
  const params = mockExecuteTool.mock.calls[0][1] as {
    _sandboxFiles?: Array<{ path: string; type?: string; content?: string; url?: string }>
  }
  return params._sandboxFiles ?? []
}

function resetExecutionMocks(): void {
  vi.clearAllMocks()
  mockExecuteTool.mockReset()
  mockMaterializeCopilotCodeSecrets.mockReset()
  mockGetTableSnapshotModelMountSafety.mockReset()
  mockGetTableSnapshotModelMountSafety.mockResolvedValue('safe')
  mockListWorkspaceFiles.mockResolvedValue([])
  mockListWorkspaceFileFolders.mockResolvedValue([])
  mockListAllWorkspaceFiles.mockImplementation(async () => {
    const files = await mockListWorkspaceFiles()
    if (files.length > 0) return { files }
    const fallback = mockFindWorkspaceFileRecord()
    return { files: fallback ? [fallback] : [] }
  })
  mockListWorkspaceFileFoldersOperation.mockImplementation(async () => ({
    folders: await mockListWorkspaceFileFolders(),
  }))
  mockDownloadWorkspaceFileRecord.mockImplementation(
    async ({ input }: { input: { fileId: string } }) => {
      const files = await mockListWorkspaceFiles()
      const file =
        files.find((candidate: { id: string }) => candidate.id === input.fileId) ??
        mockFindWorkspaceFileRecord()
      if (!file) throw new Error('File not found')
      return { file }
    }
  )
  mockReadWorkspaceFileContent.mockImplementation(
    async ({ input }: { input: { fileId: string } }) => {
      const files = await mockListWorkspaceFiles()
      const file =
        files.find((candidate: { id: string }) => candidate.id === input.fileId) ??
        mockFindWorkspaceFileRecord()
      if (!file) throw new Error('File not found')
      return { file, content: await mockFetchWorkspaceFileBuffer(file) }
    }
  )
}

describe('executeFunctionExecute trace-secret provenance', () => {
  beforeEach(() => {
    resetExecutionMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockMaterializeCopilotCodeSecrets.mockResolvedValue({ envVars: {}, catalogEntries: [] })
    mockHasWorkspaceSandboxAccess.mockResolvedValue(true)
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
  })

  it('runs Assistant compute without workspace secrets even if a caller supplies a secret actor', async () => {
    await executeFunctionExecute(
      { code: 'return 6 * 7', envVars: { LEAK: 'forged' } },
      {
        userId: 'u1',
        workflowId: '',
        workspaceId: 'ws_1',
        requestMode: 'assistant',
        secretActorUserId: 'u1',
      }
    )
    expect(mockMaterializeCopilotCodeSecrets).not.toHaveBeenCalled()
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({ envVars: {}, mountedSecrets: [] }),
      expect.anything()
    )
  })

  it.each([
    { secrets: ['API_KEY'] },
    { inputTables: ['table'] },
    { inputs: { tables: ['table'] } },
    { outputTable: { name: 'output' } },
    { code: 'return {{API_KEY}}' },
  ])('refuses Assistant table and secret access before executing code: %j', async (params) => {
    await expect(
      executeFunctionExecute(
        { code: 'return 1', ...params },
        {
          userId: 'u1',
          workflowId: '',
          workspaceId: 'ws_1',
          requestMode: 'assistant',
          secretActorUserId: 'u1',
        }
      )
    ).rejects.toThrow()
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(mockMaterializeCopilotCodeSecrets).not.toHaveBeenCalled()
  })

  it('mounts only explicit references and imports active provenance out of band', async () => {
    mockMaterializeCopilotCodeSecrets.mockResolvedValue({
      envVars: { API_KEY: 'secret-value' },
      catalogEntries: [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
    })
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry.recordResolved('API_KEY', 'secret-value')
      return { success: true, output: { result: 'secret-value' } }
    })
    const resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
      { userId: 'u1', workspaceId: 'ws_1' }
    )
    const runtimeResult = await executeFunctionExecute(
      {
        code: 'return {{API_KEY}}',
        envVars: { ATTACKER_KEY: 'attacker-value' },
        secretScope: 'all',
        mountedSecrets: ['ATTACKER_KEY'],
        _context: { resolvedSecretTraceRegistry: 'attacker-value' },
      },
      {
        userId: 'u1',
        workflowId: '',
        workspaceId: 'ws_1',
        resolvedSecretTraceRegistry,
      }
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        envVars: { API_KEY: 'secret-value' },
        secretScope: 'selected',
        mountedSecrets: ['API_KEY'],
        _context: expect.not.objectContaining({ resolvedSecretTraceRegistry: expect.anything() }),
      }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
        operationContext: expect.objectContaining({ userId: 'u1', workspaceId: 'ws_1' }),
      })
    )
    const appParams = mockExecuteTool.mock.calls[0]?.[1] as Record<string, unknown>
    expect(JSON.stringify(appParams)).not.toContain('resolvedSecretTraceRegistry')
    expect(runtimeResult).toEqual({ success: true, output: { result: 'secret-value' } })
    expect(resolvedSecretTraceRegistry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
  })

  it('does not mount direct environment-map or shell-variable access', async () => {
    await executeFunctionExecute(
      { code: 'return environmentVariables.API_KEY + "$API_KEY"' },
      { userId: 'u1', workflowId: '', workspaceId: 'ws_1' }
    )

    expect(mockMaterializeCopilotCodeSecrets).not.toHaveBeenCalled()
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({ envVars: {}, secretScope: 'selected', mountedSecrets: [] }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
        operationContext: expect.objectContaining({ userId: 'u1', workspaceId: 'ws_1' }),
      })
    )
  })

  it.each([
    {
      language: 'javascript',
      code: 'const matcher = /^{{PATTERN}}$/i; return "Bearer {{TOKEN}}" // {{COMMENT}}',
      names: ['PATTERN', 'TOKEN'],
    },
    {
      language: 'python',
      code: 'value = "{{TOKEN}}"\n# {{COMMENT}}\n__sim_result__ = value',
      names: ['TOKEN'],
    },
    {
      language: 'shell',
      code: "cat <<'PAYLOAD'\nBearer {{TOKEN}}\n$HOME\nPAYLOAD\n# {{COMMENT}}",
      names: ['TOKEN'],
    },
  ])(
    'uses the shared $language compiler analysis before delegating source to run_function',
    async ({ language, code, names }) => {
      await executeFunctionExecute({ language, code }, context as never)

      expect(mockMaterializeCopilotCodeSecrets).toHaveBeenCalledWith({
        actorUserId: 'u1',
        workspaceId: 'ws_1',
        requestedNames: names,
      })
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'function_execute',
        expect.objectContaining({ code, language, mountedSecrets: names }),
        expect.objectContaining({
          resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
          operationContext: expect.objectContaining({ userId: 'u1', workspaceId: 'ws_1' }),
        })
      )
    }
  )

  it('routes run_code shell commands through the same run_function boundary', async () => {
    const code = 'printf %s "{{CLI_TOKEN}}"'
    const abortController = new AbortController()

    await executeRunCode(
      { language: 'shell', code },
      {
        ...context,
        workflowId: '',
        sandboxProfile: 'mothership',
        abortSignal: abortController.signal,
      }
    )

    expect(mockMaterializeCopilotCodeSecrets).toHaveBeenCalledWith({
      actorUserId: 'u1',
      workspaceId: 'ws_1',
      requestedNames: ['CLI_TOKEN'],
    })
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({ code, language: 'shell', mountedSecrets: ['CLI_TOKEN'] }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
        operationContext: expect.objectContaining({ userId: 'u1', workspaceId: 'ws_1' }),
        internalSandboxProfile: 'mothership',
        signal: abortController.signal,
      })
    )
  })

  it('uses the trusted Mothership profile for run_function without accepting a param override', async () => {
    await executeFunctionExecute(
      {
        code: 'return 1',
        sandboxProfile: 'attacker',
        _context: { sandboxProfile: 'attacker' },
      },
      { ...context, workflowId: '', sandboxProfile: 'mothership' }
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        _context: expect.not.objectContaining({ sandboxProfile: expect.anything() }),
      }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
        operationContext: expect.objectContaining({ userId: 'u1', workspaceId: 'ws_1' }),
        internalSandboxProfile: 'mothership',
      })
    )
    expect(mockExecuteTool.mock.calls[0]?.[1]).not.toHaveProperty('sandboxProfile')
  })

  it('passes an entitled Sim sandbox selection through to the shared function executor', async () => {
    await executeFunctionExecute(
      { code: 'import pandas', language: 'python', sandboxId: ' sandbox-1 ' },
      { ...context, workflowId: '', sandboxProfile: 'mothership' }
    )

    expect(mockHasWorkspaceSandboxAccess).toHaveBeenCalledWith('ws_1')
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({ sandboxId: 'sandbox-1' }),
      expect.objectContaining({ internalSandboxProfile: 'mothership' })
    )
  })

  it('rejects a Sim sandbox selection when the workspace is not entitled', async () => {
    mockHasWorkspaceSandboxAccess.mockResolvedValue(false)

    await expect(
      executeFunctionExecute(
        { code: 'return 1', sandboxId: 'sandbox-1' },
        { ...context, workflowId: '', sandboxProfile: 'mothership' }
      )
    ).rejects.toThrow('Max or Enterprise')
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('returns the raw runtime result when provenance import fails', async () => {
    mockMaterializeCopilotCodeSecrets.mockResolvedValue({
      envVars: { API_KEY: 'secret-value' },
      catalogEntries: [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
    })
    const runtimeResult = { success: true, output: { result: 'secret-value' } }
    mockExecuteTool.mockResolvedValue(runtimeResult)
    const resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'u1',
      workspaceId: 'ws_1',
    })
    vi.spyOn(resolvedSecretTraceRegistry, 'importProvenance').mockRejectedValueOnce(
      new Error('provenance import failed')
    )

    await expect(
      executeFunctionExecute(
        { code: 'return {{API_KEY}}' },
        {
          userId: 'u1',
          workflowId: '',
          workspaceId: 'ws_1',
          resolvedSecretTraceRegistry,
        }
      )
    ).resolves.toBe(runtimeResult)
    expect(resolvedSecretTraceRegistry.isComplete()).toBe(false)
  })

  it('does not let pending sibling materialization poison independent model projection', async () => {
    let completeMaterialization: ((value: unknown) => void) | undefined
    mockMaterializeCopilotCodeSecrets.mockReturnValueOnce(
      new Promise((resolve) => {
        completeMaterialization = resolve
      })
    )
    const resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
      { userId: 'u1', workspaceId: 'ws_1' }
    )
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      expect(resolvedSecretTraceRegistry.isComplete()).toBe(false)
      options.resolvedSecretTraceRegistry.recordResolved('API_KEY', 'secret-value')
      return { success: true, output: { result: 'secret-value' } }
    })

    const execution = executeFunctionExecute(
      { code: 'return {{API_KEY}}' },
      {
        userId: 'u1',
        workflowId: '',
        workspaceId: 'ws_1',
        resolvedSecretTraceRegistry,
      }
    )

    await vi.waitFor(() => expect(mockMaterializeCopilotCodeSecrets).toHaveBeenCalledOnce())
    expect(resolvedSecretTraceRegistry.isComplete()).toBe(false)
    expect(
      projectToolResultForCopilot(
        { success: true, output: { result: 'secret-value' } },
        resolvedSecretTraceRegistry
      )
    ).toEqual({ success: true, output: { result: 'secret-value' } })

    completeMaterialization?.({
      envVars: { API_KEY: 'secret-value' },
      catalogEntries: [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
    })
    await execution

    expect(resolvedSecretTraceRegistry.isComplete()).toBe(true)
    expect(resolvedSecretTraceRegistry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
    expect(
      projectToolResultForCopilot(
        { success: true, output: { result: 'secret-value' } },
        resolvedSecretTraceRegistry
      )
    ).toEqual({ success: true, output: { result: '{{API_KEY}}' } })
    expect(mockExecuteTool).toHaveBeenCalledOnce()
  })

  it('does not activate a mounted reference when the Function route rejects before resolution', async () => {
    mockMaterializeCopilotCodeSecrets.mockResolvedValue({
      envVars: { API_KEY: 'secret-value' },
      catalogEntries: [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
    })
    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      error: 'Too many sandbox output files requested',
    })
    const resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
      { userId: 'u1', workspaceId: 'ws_1' }
    )

    await expect(
      executeFunctionExecute(
        { code: 'return {{API_KEY}}' },
        {
          userId: 'u1',
          workflowId: '',
          workspaceId: 'ws_1',
          resolvedSecretTraceRegistry,
        }
      )
    ).resolves.toEqual({
      success: false,
      error: 'Too many sandbox output files requested',
    })

    expect(resolvedSecretTraceRegistry.isComplete()).toBe(true)
    expect(resolvedSecretTraceRegistry.getActiveMatches()).toEqual([])
  })

  it('releases pending provenance without activation when mounting is denied', async () => {
    mockMaterializeCopilotCodeSecrets.mockRejectedValueOnce(new Error('mount denied'))
    const resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'API_KEY',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-secret-value',
        },
      ],
      { userId: 'u1', workspaceId: 'ws_1' }
    )

    await expect(
      executeFunctionExecute(
        { code: 'return {{API_KEY}}' },
        {
          userId: 'u1',
          workflowId: '',
          workspaceId: 'ws_1',
          resolvedSecretTraceRegistry,
        }
      )
    ).rejects.toThrow('mount denied')

    expect(resolvedSecretTraceRegistry.isComplete()).toBe(true)
    expect(resolvedSecretTraceRegistry.getActiveMatches()).toEqual([])
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})

describe('executeFunctionExecute table mounts', () => {
  beforeEach(() => {
    resetExecutionMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockGetTableById.mockResolvedValue(table)
    mockHasCloudStorage.mockReturnValue(true)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3.example/presigned?sig=abc')
  })

  it('mounts every table by presigned snapshot URL', async () => {
    mockGetTableById.mockResolvedValue({ ...table, rowCount: 0 })
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGetOrCreateTableSnapshot).toHaveBeenCalledTimes(1)
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'table-snapshots/ws_1/tbl_1/v5.csv',
      'execution',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/tables/tbl_1.csv',
      url: 'https://s3.example/presigned?sig=abc',
      // The snapshot's own ceiling, enforced on the bytes the sandbox pulls.
      maxBytes: SNAPSHOT_MAX_BYTES,
    })
  })

  it('mounts a complete snapshot through a bounded buffer with local storage', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })
    mockDownloadFile.mockResolvedValue(Buffer.from('name\nAda\n'))

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'table-snapshots/ws_1/tbl_1/v5.csv', context: 'execution' })
    )
    const file = mountedFiles()[0]
    expect(file.path).toBe('/home/user/tables/tbl_1.csv')
    expect(file.content).toBe('name\nAda\n')
    expect(file.type).toBeUndefined()
  })

  it('unknown snapshot provenance still mounts and taints model egress', async () => {
    mockGetTableSnapshotModelMountSafety.mockResolvedValue('unsafe-provenance')
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'raw output' } })
    const parentRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'u1',
      workspaceId: 'ws_1',
    })

    const result = await executeFunctionExecute(
      { inputTables: ['tbl_1'] },
      { ...context, resolvedSecretTraceRegistry: parentRegistry }
    )

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalled()
    expect(mockExecuteTool.mock.calls[0]?.[1]?.[PRIVATE_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: false,
      selections: [],
    })
    expect(result).toEqual({ success: true, output: { result: 'raw output' } })
    expect(parentRegistry.isComplete()).toBe(false)
    expect(projectToolResultForCopilot(result, parentRegistry)).toEqual({ success: true })
  })

  it('rejects a snapshot that becomes stale before mounting', async () => {
    mockGetTableSnapshotModelMountSafety.mockResolvedValue('stale')
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/changed while preparing its snapshot/)
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('throws when a cloud snapshot exceeds the table mount limit', async () => {
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 600 * 1024 * 1024,
      version: 5,
    })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/table mount limit/)
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('throws when cloud snapshots exceed the aggregate URL mount limit', async () => {
    mockGetTableById.mockImplementation(async (tableId: string) => ({ ...table, id: tableId }))
    mockGetOrCreateTableSnapshot.mockImplementation(async (mountedTable: typeof table) => ({
      key: `table-snapshots/ws_1/${mountedTable.id}/v5.csv`,
      size: 500 * 1024 * 1024,
      version: 5,
    }))
    const tableIds = Array.from({ length: 5 }, (_, index) => `tbl_${index}`)

    await expect(
      executeFunctionExecute({ inputTables: tableIds }, context as never)
    ).rejects.toThrow(/total mount limit/)
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledTimes(4)
  })

  it('throws when a local snapshot exceeds the per-file mount limit', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 20 * 1024 * 1024,
      version: 5,
    })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/per-file mount limit/)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('rejects a table that belongs to another workspace (tenant isolation)', async () => {
    mockGetTableById.mockResolvedValue({ ...table, workspaceId: 'ws_2' })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/Input table not found/)
    expect(mockGetOrCreateTableSnapshot).not.toHaveBeenCalled()
  })
})

const fileRecord = {
  id: 'file_1',
  workspaceId: 'ws_1',
  name: 'data.csv',
  key: 'workspace/ws_1/data.csv',
  path: '/api/files/serve/workspace%2Fws_1%2Fdata.csv',
  size: 100,
  type: 'text/csv',
  storageContext: 'workspace' as const,
}

describe('executeFunctionExecute file mounts', () => {
  beforeEach(() => {
    resetExecutionMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockHasCloudStorage.mockReturnValue(true)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3.example/file?sig=abc')
    mockListWorkspaceFiles.mockResolvedValue([fileRecord])
    mockFindWorkspaceFileRecord.mockReturnValue(fileRecord)
    mockGetSandboxWorkspaceFilePath.mockReturnValue('/home/user/files/data.csv')
    mockImportWorkspaceFileSecretProvenanceForRuntime.mockResolvedValue(true)
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
  })

  it('cloud storage: mounts by presigned URL with the record context, no bytes through web', async () => {
    await executeFunctionExecute({ inputFiles: ['files/data.csv'] }, context as never)

    expect(mockImportWorkspaceFileSecretProvenanceForRuntime).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      identity: {
        fileId: 'file_1',
        key: 'workspace/ws_1/data.csv',
        context: 'workspace',
      },
      registry: expect.any(ResolvedSecretTraceRegistry),
    })
    expect(
      mockImportWorkspaceFileSecretProvenanceForRuntime.mock.invocationCallOrder[0]
    ).toBeLessThan(mockGeneratePresignedDownloadUrl.mock.invocationCallOrder[0])
    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'workspace/ws_1/data.csv',
      'workspace',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/files/data.csv',
      url: 'https://s3.example/file?sig=abc',
      // Copilot's URL mounts share the transport, so each is granted exactly
      // the size it was charged against the aggregate.
      maxBytes: 100,
    })
  })

  it('local storage: falls back to a buffered inline content mount', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('name\nAda\n'))

    await executeFunctionExecute({ inputFiles: ['files/data.csv'] }, context as never)

    expect(
      mockImportWorkspaceFileSecretProvenanceForRuntime.mock.invocationCallOrder[0]
    ).toBeLessThan(mockFetchWorkspaceFileBuffer.mock.invocationCallOrder[0])
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    const file = mountedFiles()[0]
    expect(file.path).toBe('/home/user/files/data.csv')
    expect(file.content).toBe('name\nAda\n')
    expect(file.type).toBeUndefined()
  })

  it('mounts unavailable file provenance and taints only the model-facing result', async () => {
    mockImportWorkspaceFileSecretProvenanceForRuntime.mockResolvedValue(false)
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'raw output' } })
    const parentRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'u1',
      workspaceId: 'ws_1',
    })

    const result = await executeFunctionExecute(
      { inputFiles: ['files/data.csv'] },
      { ...context, resolvedSecretTraceRegistry: parentRegistry }
    )

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalled()
    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockExecuteTool.mock.calls[0]?.[1]?.[PRIVATE_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: false,
      selections: [],
    })
    expect(result).toEqual({ success: true, output: { result: 'raw output' } })
    expect(parentRegistry.isComplete()).toBe(false)
    expect(projectToolResultForCopilot(result, parentRegistry)).toEqual({ success: true })
  })

  it('preserves existing ordinary mounts while sending resolver-owned mount provenance', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeFunctionExecute(
      {
        inputFiles: ['files/data.csv'],
        _sandboxFiles: [{ path: '/home/user/preserved.bin', content: 'from another resolver' }],
      },
      context
    )

    const call = mockExecuteTool.mock.calls[0]?.[1]
    expect(call?._sandboxFiles?.length).toBeGreaterThan(1)
    expect(call?.[PRIVATE_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: true,
      selections: [
        {
          key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
          provenance: expect.objectContaining({ version: 1, complete: true, entries: [] }),
        },
      ],
    })
  })

  it('projects only mounted-file secrets that cross the settled Function result', async () => {
    mockImportWorkspaceFileSecretProvenanceForRuntime.mockImplementation(
      async ({ registry }: { registry?: ResolvedSecretTraceRegistry }) =>
        registry?.importProvenance(
          {
            version: 1,
            complete: true,
            entries: [{ name: 'FILE_SECRET', encryptedValue: 'encrypted-file-secret' }],
          },
          { trusted: true }
        ) ?? false
    )
    const parentRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'u1',
      workspaceId: 'ws_1',
    })
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { result: 'secret-value' },
    })

    const result = await executeFunctionExecute(
      { inputFiles: ['files/data.csv'] },
      { ...context, workflowId: '', resolvedSecretTraceRegistry: parentRegistry }
    )

    const privateBundle = mockExecuteTool.mock.calls[0]?.[1]?.[PRIVATE_SECRET_PROVENANCE_FIELD]
    expect(privateBundle).toEqual({
      version: 1,
      complete: true,
      selections: [
        {
          key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
          provenance: expect.objectContaining({
            version: 1,
            complete: true,
            entries: [{ encryptedValue: 'encrypted-file-secret' }],
          }),
        },
      ],
    })
    expect(JSON.stringify(privateBundle)).not.toContain('secret-value')

    expect(projectToolResultForCopilot(result, parentRegistry)).toEqual({
      success: true,
      output: { result: '[REDACTED_SECRET]' },
    })
  })

  it('does not activate mounted-file provenance when no tracked bytes cross the result', async () => {
    mockImportWorkspaceFileSecretProvenanceForRuntime.mockImplementation(
      async ({ registry }: { registry?: ResolvedSecretTraceRegistry }) =>
        registry?.importProvenance(
          {
            version: 1,
            complete: true,
            entries: [{ name: 'FILE_SECRET', encryptedValue: 'encrypted-file-secret' }],
          },
          { trusted: true }
        ) ?? false
    )
    const parentRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'u1',
      workspaceId: 'ws_1',
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'ordinary' } })

    const result = await executeFunctionExecute(
      { inputFiles: ['files/data.csv'] },
      { ...context, workflowId: '', resolvedSecretTraceRegistry: parentRegistry }
    )

    expect(projectToolResultForCopilot(result, parentRegistry)).toEqual(result)
    expect(parentRegistry.getActiveMatches()).toEqual([])
  })

  describe('generated documents', () => {
    const docRecord = {
      ...fileRecord,
      name: 'report.docx',
      key: 'workspace/ws_1/report.docx',
      // The stored bytes are the generator source, so the record declares its size.
      type: 'text/x-docxjs',
      size: 6_242,
    }

    beforeEach(() => {
      mockFindWorkspaceFileRecord.mockReturnValue(docRecord)
      mockListWorkspaceFiles.mockResolvedValue([docRecord])
      mockGetSandboxWorkspaceFilePath.mockReturnValue('/home/user/files/report.docx')
      mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
        buffer: Buffer.from('PK\u0003\u0004rendered-docx'),
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    })

    it('never presigns the raw key, even on cloud storage', async () => {
      mockHasCloudStorage.mockReturnValue(true)

      await executeFunctionExecute({ inputFiles: ['files/report.docx'] }, context as never)

      // Presigning record.key would hand the sandbox the generator source.
      expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
      expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
      expect(mockFetchServableWorkspaceFileBuffer).toHaveBeenCalledTimes(1)
    })

    it('mounts the rendered bytes as base64, not utf-8', async () => {
      mockHasCloudStorage.mockReturnValue(true)

      await executeFunctionExecute({ inputFiles: ['files/report.docx'] }, context as never)

      const file = mountedFiles()[0]
      // record.type is text/x-docxjs; keying off it would utf-8 decode a binary.
      expect(file.encoding).toBe('base64')
      expect(Buffer.from(file.content as string, 'base64').toString()).toContain('rendered-docx')
    })

    it('budgets the mount on rendered length, not the declared source size', async () => {
      mockHasCloudStorage.mockReturnValue(true)
      // A tiny source that renders past the aggregate mount budget.
      mockFetchServableWorkspaceFileBuffer.mockRejectedValue(
        new PayloadSizeLimitError({ label: 'servable file download', maxBytes: 1 })
      )

      await expect(
        executeFunctionExecute({ inputFiles: ['files/report.docx'] }, context as never)
      ).rejects.toThrow(/mount limit/)
    })
  })

  it('cloud storage: throws when a file exceeds the per-file URL mount limit', async () => {
    const oversized = { ...fileRecord, size: 600 * 1024 * 1024 }
    mockFindWorkspaceFileRecord.mockReturnValue(oversized)
    mockListWorkspaceFiles.mockResolvedValue([oversized])

    await expect(
      executeFunctionExecute({ inputFiles: ['files/data.csv'] }, context as never)
    ).rejects.toThrow(/per-file mount limit/)
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('cloud storage: throws when mounts exceed the aggregate URL mount limit', async () => {
    // Each file is at the 500MB per-file cap; the 5th pushes the running total past 2GB.
    const oversized = { ...fileRecord, size: 500 * 1024 * 1024 }
    mockFindWorkspaceFileRecord.mockReturnValue(oversized)
    mockListWorkspaceFiles.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        ...oversized,
        id: `file_${i}`,
        name: `big-${i}.csv`,
      }))
    )
    const paths = Array.from({ length: 5 }, (_, i) => `files/big-${i}.csv`)

    await expect(executeFunctionExecute({ inputFiles: paths }, context as never)).rejects.toThrow(
      /total mount limit/
    )
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledTimes(4)
  })

  it('throws when the inputFiles list exceeds the mounted-file count cap', async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `files/f-${i}.csv`)

    await expect(executeFunctionExecute({ inputFiles: paths }, context as never)).rejects.toThrow(
      /Too many input files/
    )
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('cloud storage: mounts each directory descendant by presigned URL', async () => {
    mockListWorkspaceFileFolders.mockResolvedValue([{ path: 'Reports' }])
    const descendant = {
      ...fileRecord,
      name: 'q1.csv',
      key: 'workspace/ws_1/q1.csv',
      folderPath: 'Reports',
    }
    mockListWorkspaceFiles.mockResolvedValue([descendant])

    await executeFunctionExecute({ inputs: { directories: ['files/Reports'] } }, context as never)

    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'workspace/ws_1/q1.csv',
      'workspace',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/files/Reports/q1.csv',
      url: 'https://s3.example/file?sig=abc',
      // Copilot's URL mounts share the transport, so each is granted exactly
      // the size it was charged against the aggregate.
      maxBytes: 100,
    })
  })

  it('mounts a directory descendant with unavailable provenance as incomplete', async () => {
    mockListWorkspaceFileFolders.mockResolvedValue([{ path: 'Reports' }])
    mockListWorkspaceFiles.mockResolvedValue([
      {
        ...fileRecord,
        name: 'q1.csv',
        key: 'workspace/ws_1/q1.csv',
        folderPath: 'Reports',
      },
    ])
    mockImportWorkspaceFileSecretProvenanceForRuntime.mockResolvedValue(false)

    await executeFunctionExecute({ inputs: { directories: ['files/Reports'] } }, context as never)

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalled()
    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockExecuteTool).toHaveBeenCalled()
    expect(mockExecuteTool.mock.calls[0]?.[1]?.[PRIVATE_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: false,
      selections: [],
    })
  })

  it('local storage: buffers directory descendants via inline content', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    mockListWorkspaceFileFolders.mockResolvedValue([{ path: 'Reports' }])
    const descendant = {
      ...fileRecord,
      name: 'q1.csv',
      key: 'workspace/ws_1/q1.csv',
      folderPath: 'Reports',
    }
    mockListWorkspaceFiles.mockResolvedValue([descendant])
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('a,b\n1,2\n'))

    await executeFunctionExecute({ inputs: { directories: ['files/Reports'] } }, context as never)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    const file = mountedFiles()[0]
    expect(file.path).toBe('/home/user/files/Reports/q1.csv')
    expect(file.content).toBe('a,b\n1,2\n')
    expect(file.type).toBeUndefined()
  })
})

async function mountError(inputs: Record<string, unknown>): Promise<string> {
  try {
    await executeFunctionExecute(inputs, context as never)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected the mount to be rejected')
}

describe('executeFunctionExecute unmountable namespaces', () => {
  beforeEach(() => {
    resetExecutionMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockHasCloudStorage.mockReturnValue(true)
    mockListWorkspaceFiles.mockResolvedValue([])
    mockFindWorkspaceFileRecord.mockReturnValue(null)
    mockListWorkspaceFileFolders.mockResolvedValue([])
  })

  it('tells the agent a tool-result artifact is backend-served, not a wrong path', async () => {
    const message = await mountError({
      inputFiles: ['internal/tool-results/user_table-toolu_019Ef.json'],
    })

    expect(message).toContain('Cannot mount "internal/tool-results/user_table-toolu_019Ef.json"')
    expect(message).toContain('stored by the copilot backend')
    expect(message).toContain('This path is correct')
    expect(message).toContain('outputs.files[].path')
    expect(message).toContain('user_table: outputPath')
    // The old message sent the agent hunting for a canonical path that never existed.
    expect(message).not.toContain('Input file not found')
    expect(message).not.toContain('canonical VFS path copied from glob/read')
  })

  it('covers the rest of internal/ without the tool-result rerun advice', async () => {
    const message = await mountError({ inputFiles: ['internal/memories/SESSION.md'] })

    expect(message).toContain('served by the copilot backend')
    expect(message).toContain('read or grep it')
    expect(message).not.toContain('outputPath')
  })

  it('points recently-deleted/ paths at restore_resource', async () => {
    const message = await mountError({ inputFiles: ['recently-deleted/files/old.csv'] })

    expect(message).toContain('restore_resource')
  })

  it('points tables/ paths at inputs.tables', async () => {
    const message = await mountError({ inputFiles: ['tables/Leads/meta.json'] })

    expect(message).toContain('inputs.tables')
  })

  it('names the namespace for VFS metadata views', async () => {
    const message = await mountError({ inputFiles: ['workflows/My%20Flow/state.json'] })

    expect(message).toContain('workflows/ paths are VFS metadata views')
  })

  it('keeps the uploads/ guidance intact', async () => {
    const message = await mountError({ inputFiles: ['uploads/report.json'] })

    expect(message).toContain('save_upload')
  })

  it('still reports a genuine files/ miss as not found', async () => {
    const message = await mountError({ inputFiles: ['files/typo.csv'] })

    expect(message).toContain('Input file not found: "files/typo.csv"')
  })

  it('explains an unmountable namespace passed as a directory', async () => {
    const message = await mountError({ inputs: { directories: ['internal/tool-results'] } })

    expect(message).toContain('Cannot mount "internal/tool-results"')
    expect(message).toContain('stored by the copilot backend')
  })

  it('still reports a genuine files/ folder miss as not found', async () => {
    const message = await mountError({ inputs: { directories: ['files/Missing'] } })

    expect(message).toContain('Input directory not found: "files/Missing"')
  })
})
