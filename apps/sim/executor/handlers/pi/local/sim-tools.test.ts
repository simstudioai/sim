/**
 * @vitest-environment node
 */
import { encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransformBlockTool, mockExecuteTool } = vi.hoisted(() => ({
  mockTransformBlockTool: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({ transformBlockTool: mockTransformBlockTool }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/tools/utils.server', () => ({ getToolAsync: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: encryptionMockFns.mockDecryptSecret,
}))

import { buildSimToolSpecs } from '@/executor/handlers/pi/local/sim-tools'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { ToolSchemaEnrichmentError } from '@/tools/params'

function executionContext(registry: ResolvedSecretTraceRegistry | undefined): ExecutionContext {
  return {
    workspaceId: 'ws-1',
    resolvedSecretTraceRegistry: registry,
  } as ExecutionContext
}

function completeExecutionContext(): ExecutionContext {
  return executionContext(new ResolvedSecretTraceRegistry())
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
    vi.clearAllMocks()
    encryptionMockFns.mockDecryptSecret.mockReset()
  })

  it('names the Pi tool with the snake_case tool id, not the human label', async () => {
    // transformBlockTool returns a human label with a space, which the model
    // provider rejects (tool names must match /^[a-zA-Z0-9_-]{1,128}$/).
    mockTransformBlockTool.mockResolvedValue({
      id: 'exa_search',
      name: 'Exa Search',
      description: 'Search the web',
      params: {},
      parameters: { type: 'object', properties: {} },
    })

    const specs = await buildSimToolSpecs(completeExecutionContext(), [
      { type: 'exa', operation: 'exa_search', usageControl: 'auto' },
    ])

    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('exa_search')
    expect(specs[0].name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
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

  it('skips mcp, custom, and usage-none tools without adapting them', async () => {
    const specs = await buildSimToolSpecs(completeExecutionContext(), [
      { type: 'mcp', usageControl: 'auto' },
      { type: 'custom-tool', usageControl: 'auto' },
      { type: 'exa', usageControl: 'none' },
    ])

    expect(specs).toHaveLength(0)
    expect(mockTransformBlockTool).not.toHaveBeenCalled()
  })

  it('fails fast when a tool schema cannot be enriched', async () => {
    const error = new ToolSchemaEnrichmentError(
      'table_query_rows',
      new Error('table metadata unavailable')
    )
    mockTransformBlockTool.mockRejectedValueOnce(error)

    await expect(
      buildSimToolSpecs(completeExecutionContext(), [
        { type: 'table', operation: 'query_rows', usageControl: 'auto' },
      ])
    ).rejects.toBe(error)
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

  it('uses the anonymous fallback for cross-scope provenance', async () => {
    mockToolAdapter()
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'foreign-secret' })
    mockExecuteTool.mockImplementation(async (_toolId, _params, options) => {
      await options.resolvedSecretTraceRegistry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'FOREIGN', encryptedValue: 'foreign-ciphertext' }],
          scope: { userId: 'foreign-user', workspaceId: 'foreign-workspace' },
        },
        { trusted: true }
      )
      return {
        success: true,
        output: { token: 'foreign-secret' },
      }
    })
    const registry = new ResolvedSecretTraceRegistry()

    const [spec] = await buildSimToolSpecs(executionContext(registry), toolInput)

    await expect(spec.execute({})).resolves.toEqual({
      text: JSON.stringify({ token: '[REDACTED_SECRET]' }),
      isError: false,
    })
  })

  it('preserves ordinary Sim tool output byte-for-byte without active provenance', async () => {
    mockToolAdapter()
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: 'ordinary external result',
    })

    const [spec] = await buildSimToolSpecs(completeExecutionContext(), toolInput)

    await expect(spec.execute({})).resolves.toEqual({
      text: 'ordinary external result',
      isError: false,
    })
  })

  it('does not rewrite an unrelated result that collides with low-entropy run provenance', async () => {
    mockToolAdapter()
    mockExecuteTool.mockResolvedValue({ success: true, output: 'Test' })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TEST_SECRET', plaintext: 'Test', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TEST_SECRET', 'Test')

    const [spec] = await buildSimToolSpecs(executionContext(registry), toolInput)

    await expect(spec.execute({})).resolves.toEqual({ text: 'Test', isError: false })
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

  it('preserves legacy Sim tool behavior when no provenance registry exists', async () => {
    mockToolAdapter()
    const output = { result: 'ordinary output' }
    mockExecuteTool.mockResolvedValue({ success: true, output })
    const [spec] = await buildSimToolSpecs(executionContext(undefined), toolInput)

    await expect(spec.execute({})).resolves.toEqual({
      text: JSON.stringify(output),
      isError: false,
    })
    expect(mockExecuteTool.mock.calls[0][2].resolvedSecretTraceRegistry).toBeUndefined()
    expect(output).toEqual({ result: 'ordinary output' })
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

  it('keeps the fixed unavailable message unchanged when active provenance contains one character', async () => {
    mockToolAdapter()
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'T' })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'LETTER', plaintext: 'T', encryptedValue: 'encrypted-letter' },
    ])
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    mockExecuteTool.mockImplementation(async (_toolId, _params, options) => {
      await options.resolvedSecretTraceRegistry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'LETTER', encryptedValue: 'encrypted-letter' }],
        },
        { trusted: true }
      )
      return { success: true, output: cyclic }
    })
    const [spec] = await buildSimToolSpecs(executionContext(registry), toolInput)

    await expect(spec.execute({})).resolves.toEqual({
      text: 'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.',
      isError: true,
    })
  })
})
