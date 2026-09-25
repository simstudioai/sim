import { runInNewContext } from 'node:vm'
import type { Principal } from '@sim/auth/principal'
import {
  environmentUtilsMockFns,
  resetEnvFlagsMock,
  resetEnvironmentUtilsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sandbox: vi.fn(),
  shell: vi.fn(),
  local: vi.fn(),
  upload: vi.fn(),
  usage: vi.fn(),
  deleteFiles: vi.fn(),
  deleteMetadata: vi.fn(),
}))
vi.mock('@/lib/catalog/application/catalog-context', () => ({
  loadCatalogWorkspaceContext: async () => ({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner',
  }),
  resolveCatalogGate: async () => ({}),
  isBlockTypeAllowed: () => true,
}))
vi.mock('@/lib/catalog/application/tool-scope', () => ({
  resolveVisibleToolOwners: async () => new Map([['function_execute', ['function']]]),
  resolveVisibleToolId: (id: string) => id,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async () => ({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner',
  }),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: async () => 'write',
  permissionSatisfies: () => true,
}))
vi.mock('@/lib/integrations/principal-scope.server', () => ({
  principalUserId: (p: { userId?: string; subjectUserId?: string }) => p.userId ?? p.subjectUserId,
}))
vi.mock('@/lib/billing/core/billing-attribution', async (original) => ({
  ...(await original<object>()),
  resolveBillingAttribution: async () => ({
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'billing-owner',
    billingEntity: { type: 'user', id: 'billing-owner' },
    billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
    payerSubscription: null,
  }),
  toBillingContext: () => ({
    billingEntity: { type: 'workspace', id: 'workspace-1' },
    billingPeriod: { start: new Date(), end: new Date() },
  }),
}))
vi.mock('@/lib/billing/core/usage-gate-cache', () => ({
  checkExecutionUsageLimits: async () => ({ isExceeded: false }),
}))
vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mocks.usage }))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: async () => {},
}))
vi.mock('@/tools/registry', async () => {
  const { functionExecuteTool } = await import('@/tools/function/execute')
  return { tools: { function_execute: functionExecuteTool } }
})
vi.mock('@/tools/utils.server', () => ({ getToolAsync: vi.fn() }))
vi.mock('@/lib/internal/tool-operations/registry.server', () => ({
  getInternalToolOperationHandler: vi.fn(),
}))
vi.mock('@/lib/execution/isolated-vm', () => ({ executeInIsolatedVM: mocks.local }))
vi.mock('@/lib/execution/remote-sandbox', () => ({
  executeInSandbox: mocks.sandbox,
  executeShellInSandbox: mocks.shell,
  SIM_RESULT_PREFIX: '__SIM_RESULT__=',
}))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: mocks.upload }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFiles: mocks.deleteFiles }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: mocks.deleteMetadata }))

import { buildJavaScriptRuntimeBindingsSource } from '@/lib/execution/code-placeholders/javascript-runtime'
import type { IsolatedVMExecutionRequest } from '@/lib/execution/isolated-vm'
import { executeToolForCaller } from '@/lib/tool-execution/application/execute-tool'

const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
function run(input: Record<string, unknown>, caller: Principal = principal) {
  return executeToolForCaller.execute({
    principal: caller,
    input: { workspaceId: 'workspace-1', toolId: 'function_execute', input },
  })
}
describe('direct Function execution', () => {
  beforeEach(() => {
    resetEnvironmentUtilsMock()
    mocks.deleteFiles.mockResolvedValue({ deleted: 1, failed: [] })
    mocks.deleteMetadata.mockResolvedValue(undefined)
    setEnvFlags({
      isHosted: false,
      isRemoteSandboxEnabled: true,
      isMothershipSandboxEnabled: false,
    })
    environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { TOKEN: 'encrypted-token' },
      personalDecrypted: {},
      workspaceDecrypted: { TOKEN: 'audit-secret' },
      decryptionFailures: [],
      personalOwners: {},
      workspaceUnredactedKeys: [],
      conflicts: [],
    })
    mocks.local.mockImplementation(async (args: IsolatedVMExecutionRequest) => {
      const stdout: string[] = []
      const context = {
        ...args.params,
        ...args.contextVariables,
        environmentVariables: args.envVars,
        console: { log: (...values: unknown[]) => stdout.push(values.map(String).join(' ')) },
      }
      try {
        const result = await runInNewContext(
          `${buildJavaScriptRuntimeBindingsSource(args.runtimeBindings ?? [])}\n(async () => {${args.code}})()`,
          context
        )
        return { result, stdout: stdout.join('\n') }
      } catch (error) {
        return {
          result: null,
          error: { message: String(error), name: 'Error' },
          stdout: stdout.join('\n'),
        }
      }
    })
    mocks.sandbox.mockResolvedValue({ result: 'ok', stdout: '', sandboxId: 'sandbox' })
    mocks.upload.mockImplementation(async ({ buffer, fileName, contentType }) => ({
      id: `copilot/file/${fileName}`,
      key: `copilot/file/${fileName}`,
      context: 'copilot',
      name: fileName,
      type: contentType,
      url: '/api/files/copilot',
      size: buffer.length,
    }))
  })
  afterAll(resetEnvFlagsMock)
  it('runs basic direct JavaScript through the real registry and Function request', async () => {
    const result = await run({ code: 'return 42' })
    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'succeeded',
      output: { result: 42 },
    })
  })
  it('resolves an explicitly mounted secret on the real direct call path', async () => {
    const result = await run({
      code: 'return {{TOKEN}} === "audit-secret"',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'succeeded',
      output: { result: true },
    })
  })
  it('returns a produced file on the real direct call path without workflow identity', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.txt',
          relativePath: 'report.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
      ],
    })
    const result = await run({
      code: 'open("/tmp/sim/outputs/report.txt", "w").write("hi")',
      language: 'python',
    })
    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'succeeded',
      output: { files: [{ context: 'copilot', name: 'report.txt' }] },
    })
  })
  it('projects returned values and stdout after the private metadata consumer activates used secrets', async () => {
    const result = await run({
      code: 'console.log({{TOKEN}}); return {{TOKEN}}',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result).toMatchObject({
      status: 'succeeded',
      output: { result: '{{TOKEN}}', stdout: '{{TOKEN}}' },
    })
    expect(JSON.stringify(result)).not.toContain('audit-secret')
    expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      { requestedNames: ['TOKEN'] }
    )
  })
  it('projects an error containing a used secret', async () => {
    const result = await run({
      code: 'throw new Error({{TOKEN}})',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result.status).toBe('failed')
    expect(result.error?.message).toContain('{{TOKEN}}')
    expect(JSON.stringify(result)).not.toContain('audit-secret')
  })
  it.each([undefined, 'all'])(
    'preserves default/all scope (%s) and activates direct environment reads',
    async (secretScope) => {
      const result = await run({
        code: 'return environmentVariables.TOKEN',
        ...(secretScope ? { secretScope } : {}),
      })
      expect(result).toMatchObject({ status: 'succeeded', output: { result: '{{TOKEN}}' } })
      expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledWith(
        'user-1',
        'workspace-1',
        {}
      )
    }
  )
  it('does not redact an unrelated literal matching an unused secret', async () => {
    const result = await run({ code: 'return "audit-secret"' })
    expect(result).toMatchObject({ status: 'succeeded', output: { result: 'audit-secret' } })
  })
  it('keeps selected-empty scope empty even when the environment contains secrets', async () => {
    const result = await run({
      code: 'return Object.keys(environmentVariables)',
      secretScope: 'selected',
      mountedSecrets: [],
    })
    expect(result).toMatchObject({ status: 'succeeded', output: { result: [] } })
    expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      { requestedNames: [] }
    )
  })
  it('does not mount an unselected secret', async () => {
    const result = await run({
      code: 'return environmentVariables.TOKEN === undefined',
      secretScope: 'selected',
      mountedSecrets: ['OTHER'],
    })
    expect(result).toMatchObject({ status: 'succeeded', output: { result: true } })
  })
  it('preserves the existing explicit workspace visibility flag', async () => {
    environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { TOKEN: 'encrypted-token' },
      personalDecrypted: {},
      workspaceDecrypted: { TOKEN: 'audit-secret' },
      decryptionFailures: [],
      personalOwners: {},
      workspaceUnredactedKeys: ['TOKEN'],
      conflicts: [],
    })
    const result = await run({
      code: 'return {{TOKEN}}',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result).toMatchObject({ status: 'succeeded', output: { result: 'audit-secret' } })
  })
  it.each([{ envVars: { TOKEN: 'forged' } }, { unredactedSecretNames: ['TOKEN'] }])(
    'rejects caller-supplied secret authority %o',
    async (extra) => {
      await expect(run({ code: 'return 1', ...extra })).rejects.toMatchObject({
        code: 'validation',
      })
      expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
      expect(mocks.local).not.toHaveBeenCalled()
    }
  )
  it.each([
    { secretScope: 'invalid' },
    { mountedSecrets: [1] },
    { mountedSecrets: Array.from({ length: 101 }, (_, index) => `SECRET_${index}`) },
  ])('rejects invalid mount selection before decrypting %o', async (selection) => {
    await expect(run({ code: 'return 1', ...selection })).rejects.toMatchObject({
      code: 'validation',
    })
    expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
  })
  it('stores ordinary outputs under the real actor rather than the billing owner', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.txt',
          relativePath: 'report.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
      ],
    })
    await run({
      code: 'print("hi")',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: [],
    })
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        fileName: 'report.txt',
        buffer: Buffer.from('hi'),
      })
    )
  })
  it('returns a binary output when no secret was used', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.pdf',
          relativePath: 'report.pdf',
          contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
          byteLength: 8,
        },
      ],
    })
    const result = await run({
      code: 'print("hi")',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: [],
    })
    expect(result).toMatchObject({
      status: 'succeeded',
      output: { files: [{ context: 'copilot', name: 'report.pdf' }] },
    })
  })
  it('refuses literal secret file content before personal upload', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.txt',
          relativePath: 'report.txt',
          contentBase64: Buffer.from('audit-secret').toString('base64'),
          byteLength: 12,
        },
      ],
    })
    const result = await run({
      code: 'token = {{TOKEN}}',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result.status).toBe('failed')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('audit-secret')
  })
  it('refuses uncertain binary output after secret use without persisting incomplete provenance', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.pdf',
          relativePath: 'report.pdf',
          contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
          byteLength: 8,
        },
      ],
    })
    const result = await run({
      code: 'token = {{TOKEN}}',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result.status).toBe('failed')
    expect(result.error?.message).toContain('secret provenance is uncertain')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('removes earlier personal uploads if a later collected file is refused', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.txt',
          relativePath: 'report.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
        {
          path: '/tmp/sim/outputs/secret.txt',
          relativePath: 'secret.txt',
          contentBase64: Buffer.from('audit-secret').toString('base64'),
          byteLength: 12,
        },
      ],
    })
    const result = await run({
      code: 'token = {{TOKEN}}',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result.status).toBe('failed')
    expect(mocks.deleteFiles).toHaveBeenCalledWith(['copilot/file/report.txt'], 'copilot')
    expect(mocks.deleteMetadata).toHaveBeenCalledWith('copilot/file/report.txt')
  })
  it('retains metadata for a partial upload whose object could not be removed', async () => {
    mocks.deleteFiles.mockResolvedValue({
      deleted: 0,
      failed: [{ key: 'copilot/file/report.txt', error: 'unavailable' }],
    })
    mocks.upload
      .mockResolvedValueOnce({
        id: 'copilot/file/report.txt',
        key: 'copilot/file/report.txt',
        context: 'copilot',
        name: 'report.txt',
        size: 2,
        type: 'text/plain',
        url: '/api/file',
      })
      .mockRejectedValueOnce(new Error('upload unavailable'))
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.txt',
          relativePath: 'report.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
        {
          path: '/tmp/sim/outputs/second.txt',
          relativePath: 'second.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
      ],
    })
    const result = await run({
      code: 'print("hi")',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: [],
    })
    expect(result.status).toBe('failed')
    expect(mocks.deleteFiles).toHaveBeenCalledWith(['copilot/file/report.txt'], 'copilot')
    expect(mocks.deleteMetadata).not.toHaveBeenCalled()
  })
  it('continues metadata cleanup after an earlier metadata update fails', async () => {
    mocks.deleteFiles.mockResolvedValue({ deleted: 2, failed: [] })
    mocks.deleteMetadata.mockRejectedValueOnce(new Error('metadata unavailable'))
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: ['first.txt', 'second.txt', 'secret.txt'].map((name, index) => {
        const content = index === 2 ? 'audit-secret' : 'hi'
        return {
          path: `/tmp/sim/outputs/${name}`,
          relativePath: name,
          contentBase64: Buffer.from(content).toString('base64'),
          byteLength: Buffer.byteLength(content),
        }
      }),
    })
    const result = await run({
      code: 'token = {{TOKEN}}',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result.status).toBe('failed')
    expect(result.error?.message).toContain('contains a resolved secret value')
    expect(mocks.deleteFiles).toHaveBeenCalledWith(
      ['copilot/file/first.txt', 'copilot/file/second.txt'],
      'copilot'
    )
    expect(mocks.deleteMetadata).toHaveBeenNthCalledWith(1, 'copilot/file/first.txt')
    expect(mocks.deleteMetadata).toHaveBeenNthCalledWith(2, 'copilot/file/second.txt')
    expect(JSON.stringify(result)).not.toContain('audit-secret')
  })
  it('refuses a secret-bearing filename before personal upload or storage logging', async () => {
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/audit-secret.txt',
          relativePath: 'audit-secret.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
      ],
    })
    const result = await run({
      code: 'token = {{TOKEN}}',
      language: 'python',
      secretScope: 'selected',
      mountedSecrets: ['TOKEN'],
    })
    expect(result.status).toBe('failed')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('audit-secret')
  })
  it('preserves delegated Copilot execution without resolving a new environment', async () => {
    const delegated: Principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:tool-execution',
      issuedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60000),
    }
    const result = await run({ code: 'return 42' }, delegated)
    expect(result).toMatchObject({ status: 'succeeded', output: { result: 42 } })
    expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    expect(mocks.local).toHaveBeenCalledWith(
      expect.objectContaining({ envVars: {} }),
      expect.anything()
    )
  })
  it('does not turn delegated Copilot sandbox outputs into personal files', async () => {
    const delegated: Principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:tool-execution',
      issuedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60000),
    }
    mocks.sandbox.mockResolvedValue({
      result: null,
      stdout: '',
      sandboxId: 'sandbox',
      collectedFiles: [
        {
          path: '/tmp/sim/outputs/report.txt',
          relativePath: 'report.txt',
          contentBase64: 'aGk=',
          byteLength: 2,
        },
      ],
    })
    const result = await run({ code: 'print("hi")', language: 'python' }, delegated)
    expect(result.status).toBe('failed')
    expect(result.error?.message).toContain('workflow, and execution context')
    expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('refuses organization delegation at the direct tool operation before sandbox dispatch', async () => {
    const organizationCaller: Principal = {
      kind: 'organization_delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      organizationId: 'organization-1',
      resourceScope: { chatId: 'chat-1' },
      delegationId: 'delegation-1',
      audience: 'sim:tool-execution',
      issuedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60000),
    }
    await expect(
      run({ code: 'print("hi")', language: 'python' }, organizationCaller)
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    expect(mocks.sandbox).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
