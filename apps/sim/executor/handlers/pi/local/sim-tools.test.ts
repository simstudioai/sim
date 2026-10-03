import { encryptionMockFns } from '@sim/testing'
import { toolsUtilsMock } from '@sim/testing/mocks/blocks.mock'
import { encryptionMock } from '@sim/testing/mocks/encryption.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@/tools/utils.server', () => ({ getToolAsync: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { buildSimToolSpecs } from '@/executor/handlers/pi/local/sim-tools'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockTransformBlockTool = providersUtilsMockFns.mockTransformBlockTool
const mockExecuteTool = toolsMockFns.mockExecuteTool

function executionContext(registry: ResolvedSecretTraceRegistry | undefined): ExecutionContext {
  return {
    workspaceId: 'ws-1',
    resolvedSecretTraceRegistry: registry,
  } as ExecutionContext
}

const toolInput = [{ type: 'exa', operation: 'exa_search', usageControl: 'auto' }]

function mockToolAdapter(params: Record<string, unknown> = {}): void {
  mockTransformBlockTool.mockResolvedValue({
    id: 'exa_search',
    name: 'Exa Search',
    description: 'Search the web',
    params,
    parameters: { type: 'object', properties: {} },
  })
}

describe('buildSimToolSpecs', () => {
  beforeEach(() => {
    encryptionMockFns.mockDecryptSecret.mockReset()
  })

  it('aliases duplicate instances while executing each with its canonical id and bound params', async () => {
    mockTransformBlockTool
      .mockResolvedValueOnce({
        id: 'gmail_send',
        name: 'Gmail Send',
        description: 'Send an email',
        params: { oauthCredential: 'credential-a' },
        parameters: { type: 'object', properties: {} },
      })
      .mockResolvedValueOnce({
        id: 'gmail_send',
        name: 'Gmail Send',
        description: 'Send an email',
        params: { oauthCredential: 'credential-b' },
        parameters: { type: 'object', properties: {} },
      })
    mockExecuteTool.mockResolvedValue({ success: true, output: 'sent' })

    const specs = await buildSimToolSpecs(executionContext(undefined), [
      { type: 'gmail', operation: 'send', usageControl: 'auto' },
      { type: 'gmail', operation: 'send', usageControl: 'auto' },
    ])

    expect(specs.map(({ name }) => name)).toEqual(['gmail_send', 'gmail_send__sim_2'])

    await specs[1].execute({ subject: 'Hello' })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'gmail_send',
      expect.objectContaining({
        oauthCredential: 'credential-b',
        subject: 'Hello',
      }),
      expect.any(Object)
    )
  })

  it('forwards a trusted _context that an LLM-supplied _context cannot override', async () => {
    mockTransformBlockTool.mockResolvedValue({
      id: 'exa_search',
      name: 'Exa Search',
      description: 'Search the web',
      params: { apiKey: 'k' },
      parameters: { type: 'object', properties: {} },
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: 'ok' })
    const trustedCtx = {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      userId: 'user-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    } as ExecutionContext

    const [spec] = await buildSimToolSpecs(trustedCtx, [
      { type: 'exa', operation: 'exa_search', usageControl: 'auto' },
    ])
    // An attacker-influenced tool arg tries to spoof the execution context.
    await spec.execute({ query: 'cats', _context: { userId: 'attacker', workspaceId: 'evil' } })

    const [toolId, callParams] = mockExecuteTool.mock.calls[0]
    expect(toolId).toBe('exa_search')
    expect(callParams._context.userId).toBe('user-1')
    expect(callParams._context.workspaceId).toBe('ws-1')
    expect(callParams._context.workflowId).toBe('wf-1')
  })

  it('accumulates cost from canonical Function results while preserving failures', async () => {
    mockTransformBlockTool
      .mockResolvedValueOnce({
        id: 'function_execute',
        name: 'Function Execute',
        description: 'Execute code',
        params: {},
        parameters: { type: 'object', properties: {} },
      })
      .mockResolvedValueOnce({
        id: 'exa_search',
        name: 'Exa Search',
        description: 'Search the web',
        params: {},
        parameters: { type: 'object', properties: {} },
      })
    const functionToolCost = { total: 0 }
    const [functionSpec, searchSpec] = await buildSimToolSpecs(
      executionContext(undefined),
      [
        { type: 'function', operation: 'execute', usageControl: 'auto' },
        { type: 'exa', operation: 'exa_search', usageControl: 'auto' },
      ],
      functionToolCost
    )

    mockExecuteTool
      .mockResolvedValueOnce({
        success: true,
        output: { result: 'ok', cost: { total: 0.125 } },
      })
      .mockResolvedValueOnce({
        success: true,
        output: { result: 'search result', cost: { total: 4 } },
      })
      .mockResolvedValueOnce({
        success: false,
        output: { cost: { total: 8 } },
        error: 'execution failed',
      })

    await functionSpec.execute({})
    await searchSpec.execute({})
    const failedResult = await functionSpec.execute({})

    expect(functionToolCost.total).toBe(8.125)
    expect(failedResult).toEqual({ text: 'execution failed', isError: true })
  })

  it('projects named provenance in successful Sim tool output', async () => {
    mockToolAdapter({ apiKey: 'secret-value' })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    mockExecuteTool.mockImplementation(async (_toolId, _params, options) => {
      await options.resolvedSecretTraceRegistry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'ciphertext' }],
        },
        { trusted: true }
      )
      return {
        success: true,
        output: { authorization: 'Bearer secret-value' },
      }
    })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('API_KEY', 'secret-value')

    const [spec] = await buildSimToolSpecs(executionContext(registry), toolInput)

    await expect(spec.execute({})).resolves.toEqual({
      text: JSON.stringify({ authorization: 'Bearer {{API_KEY}}' }),
      isError: false,
    })
  })

  it('projects only the selected tool params by original array index and leaves raw output unchanged', async () => {
    const selectedTool = {
      type: 'exa',
      operation: 'exa_search',
      usageControl: 'auto',
      params: { apiKey: 'secret-value' },
    }
    const tools = [{ type: 'exa', operation: 'exa_search', usageControl: 'none' }, selectedTool]
    mockToolAdapter(selectedTool.params)
    const output = { selected: 'secret-value', unrelated: 'Test' }
    mockExecuteTool.mockResolvedValue({ success: true, output })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
      { name: 'UNRELATED', plaintext: 'Test', encryptedValue: 'unrelated-ciphertext' },
    ])
    registry.recordResolvedAtInputPath('API_KEY', 'secret-value', [
      'tools',
      '1',
      'params',
      'apiKey',
    ])
    registry.recordResolvedInputProjection(
      ['tools', '1', 'params', 'apiKey'],
      'secret-value',
      '{{API_KEY}}'
    )
    registry.recordResolvedAtInputPath('UNRELATED', 'Test', ['task'])
    registry.recordResolvedInputProjection(['task'], 'Test', '{{UNRELATED}}')

    const [spec] = await buildSimToolSpecs(executionContext(registry), tools)

    await expect(spec.execute({ query: 'pi' })).resolves.toEqual({
      text: JSON.stringify({ selected: '{{API_KEY}}', unrelated: 'Test' }),
      isError: false,
    })
    expect(
      mockExecuteTool.mock.calls[0][2].resolvedSecretTraceRegistry
        .exportCommittedProvenanceForInputPaths([['apiKey']])
        .entries.map((entry: { name?: string }) => entry.name)
    ).toEqual(['API_KEY'])
    expect(output).toEqual({ selected: 'secret-value', unrelated: 'Test' })
  })

  it('projects error text returned or thrown by a Sim tool', async () => {
    mockToolAdapter({ apiKey: 'secret-value' })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const [spec] = await buildSimToolSpecs(executionContext(registry), toolInput)

    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      await options.resolvedSecretTraceRegistry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'ciphertext' }],
        },
        { trusted: true }
      )
      return {
        success: false,
        output: {},
        error: 'provider rejected secret-value',
      }
    })
    await expect(spec.execute({})).resolves.toEqual({
      text: 'provider rejected {{API_KEY}}',
      isError: true,
    })

    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      await options.resolvedSecretTraceRegistry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'ciphertext' }],
        },
        { trusted: true }
      )
      throw new Error('transport exposed secret-value')
    })
    await expect(spec.execute({})).resolves.toEqual({
      text: 'transport exposed {{API_KEY}}',
      isError: true,
    })
  })

  it('fails closed when Sim tool result provenance is incomplete', async () => {
    mockToolAdapter()
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { result: 'untrusted output' },
    })
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')
    const [spec] = await buildSimToolSpecs(executionContext(registry), toolInput)

    const result = await spec.execute({})

    expect(result.isError).toBe(true)
    expect(result.text).toBe(
      'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.'
    )
    expect(result.text).not.toContain('untrusted output')
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})
