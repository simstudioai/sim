/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { materializeLargeValueRefMock, storeLargeValueMock, warnMock } = vi.hoisted(() => ({
  materializeLargeValueRefMock: vi.fn(),
  storeLargeValueMock: vi.fn(),
  warnMock: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
  }),
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: materializeLargeValueRefMock,
  storeLargeValue: storeLargeValueMock,
}))

import {
  enforceTraceSpanSecretInvariant,
  projectTraceSpansForSecrets,
} from '@/lib/logs/execution/trace-secret-projection'
import type { TraceSpan } from '@/lib/logs/types'
import {
  type ResolvedSecretTraceMatch,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const MAX_CONTENT_NODES = 100_000

const STORE = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

function createRegistry(
  matches: ResolvedSecretTraceMatch[],
  complete = true
): ResolvedSecretTraceRegistry {
  return {
    isComplete: () => complete,
    getActiveMatches: () => matches,
  } as unknown as ResolvedSecretTraceRegistry
}

function createSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    id: 'span-1',
    name: 'Function',
    type: 'function',
    duration: 20,
    startTime: '2026-07-01T00:00:00.000Z',
    endTime: '2026-07-01T00:00:00.020Z',
    status: 'success',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('projectTraceSpansForSecrets', () => {
  it('removes compiler and legacy runtime aliases from projected trace content', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_SECRET',
        plaintext: 'trace-secret',
        encryptedValue: 'encrypted-api-secret',
      },
    ])
    expect(registry.recordResolved('API_SECRET', 'trace-secret')).toBe(true)

    const [projected] = await projectTraceSpansForSecrets(
      [
        createSpan({
          output: {
            legacy: '__var_API_SECRET',
            compiler: '__sim_code_0_binding_0',
            runtime: '__sim_runtime_payload_0__',
          },
        }),
      ],
      { registry, store: STORE }
    )

    expect(projected.output).toEqual({
      legacy: '[REDACTED_SECRET]',
      compiler: '[RUNTIME_BINDING]',
      runtime: '[RUNTIME_BINDING]',
    })
  })

  it('preserves named provenance when an exact secret name and value overlap', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TestName', plaintext: 'TestName', encryptedValue: 'ciphertext' },
    ])
    expect(registry.recordResolved('TestName', 'TestName')).toBe(true)
    const source = createSpan({
      input: { code: 'return {{TestName}}' },
      output: {
        result: 'TestName',
        legacy: '__var_Test',
        compiler: '__sim_code_0_binding_0',
      },
    })

    const [projected] = await projectTraceSpansForSecrets([source], {
      registry,
      store: STORE,
    })

    expect(projected.input).toEqual({ code: 'return {{TestName}}' })
    expect(projected.output).toEqual({
      result: '{{TestName}}',
      legacy: '[REDACTED_SECRET]',
      compiler: '[RUNTIME_BINDING]',
    })
    expect(JSON.stringify(projected)).not.toContain('__var_')
    expect(JSON.stringify(projected)).not.toContain('__sim_code_')
    expect(source.input).toEqual({ code: 'return {{TestName}}' })
    expect(source.output).toEqual({
      result: 'TestName',
      legacy: '__var_Test',
      compiler: '__sim_code_0_binding_0',
    })
  })

  it('protects only literals activated by a successful Secrets-tab substitution', async () => {
    const plaintext = 'trace/secret+value'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_SECRET',
        plaintext,
        encryptedValue: 'encrypted-api-secret',
      },
    ])
    const transformations = {
      urlEncoded: encodeURIComponent(plaintext),
      base64: Buffer.from(plaintext).toString('base64'),
      sha256: createHash('sha256').update(plaintext).digest('hex'),
    }
    const source = createSpan({
      output: {
        direct: `prefix:${plaintext}:suffix`,
        ...transformations,
      },
    })

    const beforeResolution = await projectTraceSpansForSecrets([source], {
      registry,
      store: STORE,
    })

    expect(beforeResolution[0].output).toEqual(source.output)
    expect(registry.recordResolved('API_SECRET', plaintext)).toBe(true)

    const afterResolution = await projectTraceSpansForSecrets([source], {
      registry,
      store: STORE,
    })

    expect(afterResolution[0].output).toEqual({
      direct: 'prefix:{{API_SECRET}}:suffix',
      ...transformations,
    })
    expect(source.output).toEqual({
      direct: `prefix:${plaintext}:suffix`,
      ...transformations,
    })
  })

  it('projects exact secret literals only inside schema-defined content', async () => {
    const secret = 'secret/value with spaces'
    const encoded = encodeURIComponent(secret)
    const source = createSpan({
      id: `structural-${secret}`,
      name: `Structural ${secret}`,
      blockId: secret,
      input: { prompt: `prefix:${secret}:suffix`, encoded },
      output: { [secret]: secret },
      thinking: `thinking ${secret}`,
      errorMessage: `error ${secret}`,
      modelToolCalls: [{ id: 'call-1', name: 'lookup', arguments: { token: secret } }],
      toolCalls: [
        {
          name: 'legacy',
          duration: 1,
          startTime: '2026-07-01T00:00:00.000Z',
          endTime: '2026-07-01T00:00:00.001Z',
          status: 'error',
          input: { token: secret },
          output: { echoed: secret },
          error: `failed ${secret}`,
        },
      ],
      providerTiming: {
        duration: 10,
        startTime: '2026-07-01T00:00:00.000Z',
        endTime: '2026-07-01T00:00:00.010Z',
        segments: [
          {
            type: 'model',
            name: 'model-1',
            startTime: 0,
            endTime: 10,
            duration: 10,
            assistantContent: secret,
            thinkingContent: `why ${secret}`,
            errorMessage: `bad ${secret}`,
            toolCalls: [{ id: 'call-2', name: 'lookup', arguments: secret }],
          },
        ],
      },
      children: [createSpan({ id: 'child-1', output: { child: secret } })],
    })

    const result = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([{ plaintext: secret, replacement: '{{API_SECRET}}' }]),
      store: STORE,
    })

    const span = result[0]
    expect(span.id).toBe(`structural-${secret}`)
    expect(span.name).toBe(`Structural ${secret}`)
    expect(span.blockId).toBe(secret)
    expect(span.input).toEqual({
      prompt: 'prefix:{{API_SECRET}}:suffix',
      encoded,
    })
    expect(span.output).toEqual({ '{{API_SECRET}}': '{{API_SECRET}}' })
    expect(span.thinking).toBe('thinking {{API_SECRET}}')
    expect(span.errorMessage).toBe('error {{API_SECRET}}')
    expect(span.modelToolCalls?.[0].arguments).toEqual({ token: '{{API_SECRET}}' })
    expect(span.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        input: { token: '{{API_SECRET}}' },
        output: { echoed: '{{API_SECRET}}' },
        error: 'failed {{API_SECRET}}',
      })
    )
    expect(span.providerTiming?.segments[0]).toEqual(
      expect.objectContaining({
        assistantContent: '{{API_SECRET}}',
        thinkingContent: 'why {{API_SECRET}}',
        errorMessage: 'bad {{API_SECRET}}',
        toolCalls: [
          expect.objectContaining({
            arguments: '{{API_SECRET}}',
          }),
        ],
      })
    )
    expect(span.children?.[0].output).toEqual({ child: '{{API_SECRET}}' })
    expect(source.output).toEqual({ [secret]: secret })
    expect(result[0]).not.toBe(source)
  })

  it('uses deterministic longest matches and does not rescan replacements', async () => {
    const result = await projectTraceSpansForSecrets(
      [createSpan({ output: { value: 'secret-suffix secretval A_SECRET' } })],
      {
        registry: createRegistry([
          { plaintext: 'secretval', replacement: '{{SHORT}}' },
          { plaintext: 'secret-suffix', replacement: '{{LONG}}' },
          { plaintext: 'A_SECRET', replacement: '{{A_SECRET}}' },
        ]),
        store: STORE,
      }
    )

    expect(result[0].output).toEqual({
      value: '{{LONG}} {{SHORT}} {{A_SECRET}}',
    })
  })

  it('keeps matching bounded with a full 10,000-entry provenance set', async () => {
    const dormant = Array.from({ length: 9_998 }, (_, index) => ({
      plaintext: `unused-secret-${index}`,
      replacement: `{{UNUSED_${index}}}`,
    }))
    const result = await projectTraceSpansForSecrets(
      [createSpan({ output: { value: 'prefix secret-suffix suffix' } })],
      {
        registry: createRegistry([
          ...dormant,
          { plaintext: 'secretval', replacement: '{{SHORT}}' },
          { plaintext: 'secret-suffix', replacement: '{{LONG}}' },
        ]),
        store: STORE,
      }
    )

    expect(result[0].output).toEqual({ value: 'prefix {{LONG}} suffix' })
  })

  it('chooses the lexicographically first replacement for duplicate plaintext', async () => {
    const result = await projectTraceSpansForSecrets(
      [createSpan({ output: { value: 'same-value' } })],
      {
        registry: createRegistry([
          { plaintext: 'same-value', replacement: '{{Z_SECRET}}' },
          { plaintext: 'same-value', replacement: '{{A_SECRET}}' },
          { plaintext: '', replacement: '{{EMPTY}}' },
        ]),
        store: STORE,
      }
    )

    expect(result[0].output).toEqual({ value: '{{A_SECRET}}' })
  })

  it('supports one-character case-sensitive secrets without altering structural fields', async () => {
    const result = await projectTraceSpansForSecrets(
      [createSpan({ id: 'A-structural', output: { value: 'AAAAAAAA a' } })],
      {
        registry: createRegistry([{ plaintext: 'AAAAAAAA', replacement: '{{LETTER}}' }]),
        store: STORE,
      }
    )

    expect(result[0].id).toBe('A-structural')
    expect(result[0].output).toEqual({ value: '{{LETTER}} a' })
  })

  it('projects a successfully resolved numeric Function result without mutating runtime output', async () => {
    const runtimeOutput = { result: 12345678, unchanged: 5678 }
    const source = createSpan({ output: runtimeOutput })

    const [result] = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([{ plaintext: '12345678', replacement: '{{NUMERIC_SECRET}}' }]),
      store: STORE,
    })

    expect(result.output).toEqual({ result: '{{NUMERIC_SECRET}}', unchanged: 5678 })
    expect(source.output).toBe(runtimeOutput)
    expect(runtimeOutput).toEqual({ result: 12345678, unchanged: 5678 })
  })

  it('does not infer or redact values derived from a resolved secret', async () => {
    const source = createSpan({
      input: { code: 'return 12345678 + 5' },
      output: { result: 1239 },
    })

    const [result] = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([{ plaintext: '12345678', replacement: '{{NUMERIC_SECRET}}' }]),
      store: STORE,
    })

    expect(result.input).toEqual({ code: 'return {{NUMERIC_SECRET}} + 5' })
    expect(result.output).toEqual({ result: 1239 })
  })

  it('omits a content field when secret replacement collides object keys', async () => {
    const result = await projectTraceSpansForSecrets(
      [createSpan({ input: { safe: 'keep' }, output: { secretval: 1, '{{TOKEN}}': 2 } })],
      {
        registry: createRegistry([{ plaintext: 'secretval', replacement: '{{TOKEN}}' }]),
        store: STORE,
      }
    )

    expect(result[0].input).toEqual({ safe: 'keep' })
    expect(result[0]).not.toHaveProperty('output')
  })

  it('returns structural-only spans when provenance is incomplete', async () => {
    const result = await projectTraceSpansForSecrets(
      [
        createSpan({
          input: { secret: 'raw' },
          output: { secret: 'raw' },
          thinking: 'raw',
          errorMessage: 'raw',
          modelToolCalls: [{ id: 'call-1', name: 'lookup', arguments: 'raw' }],
          toolCalls: [
            {
              name: 'legacy',
              duration: 1,
              startTime: '2026-07-01T00:00:00.000Z',
              endTime: '2026-07-01T00:00:00.001Z',
              status: 'error',
              error: 'raw',
            },
          ],
          providerTiming: {
            duration: 1,
            startTime: '2026-07-01T00:00:00.000Z',
            endTime: '2026-07-01T00:00:00.001Z',
            segments: [
              {
                type: 'model',
                startTime: 0,
                endTime: 1,
                duration: 1,
                assistantContent: 'raw',
                tokens: { input: 1, output: 2, total: 3 },
              },
            ],
          },
          children: [createSpan({ id: 'child-1', output: { secret: 'raw' } })],
        }),
      ],
      { registry: createRegistry([], false), store: STORE }
    )

    const span = result[0]
    expect(span).toMatchObject({
      id: 'span-1',
      name: 'Function',
      status: 'success',
      providerTiming: {
        duration: 1,
        segments: [expect.objectContaining({ tokens: { input: 1, output: 2, total: 3 } })],
      },
      children: [expect.objectContaining({ id: 'child-1' })],
    })
    expect(span).not.toHaveProperty('input')
    expect(span).not.toHaveProperty('output')
    expect(span).not.toHaveProperty('thinking')
    expect(span).not.toHaveProperty('errorMessage')
    expect(span.modelToolCalls).toEqual([{ id: 'call-1', name: 'lookup' }])
    expect(span.toolCalls).toEqual([expect.objectContaining({ name: 'legacy', status: 'error' })])
    expect(span.toolCalls?.[0]).not.toHaveProperty('error')
    expect(span.providerTiming?.segments[0]).not.toHaveProperty('assistantContent')
    expect(span.providerTiming?.segments[0].toolCalls).toBeUndefined()
    expect(span.children?.[0]).not.toHaveProperty('output')
  })

  it('fails closed when a later log transform reintroduces an active literal', async () => {
    const source = [createSpan({ output: { apiKey: '[REDACTED]' } })]

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'REDACTED', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(source[0].output).toEqual({ apiKey: '[REDACTED]' })
  })

  it('keeps content whose only literal occurrence sits inside an unrelated word', async () => {
    const source = [createSpan({ output: { summary: 'the latest news' } })]

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'testvalue', replacement: '{{TOKEN}}' }]),
      store: STORE,
    })

    expect(result).toBe(source)
    expect(result[0].output).toEqual({ summary: 'the latest news' })
  })

  it('names the invariant that forced the structural fallback', async () => {
    const source = [createSpan({ output: { apiKey: '[REDACTED]' } })]

    await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'REDACTED', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(warnMock).toHaveBeenCalledWith(
      'Trace secret invariant failed; retaining structural spans only',
      {
        failure: {
          name: 'TraceSecretProjectionError',
          reason: expect.any(String),
        },
      }
    )
  })

  it('fails the final invariant closed when provenance is incomplete', async () => {
    const source = [createSpan({ output: { value: 'ordinary' } })]

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([], false),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
  })

  it('preserves the exact span array after hydrated trace-owned refs pass the invariant', async () => {
    const safeRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'string',
      size: 7,
      preview: '{{X}}',
    } as const
    const source = [createSpan({ output: { payload: safeRef } })]
    materializeLargeValueRefMock.mockResolvedValue({ value: '{{X}}' })

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result).toBe(source)
    expect(result[0].output).toEqual({ payload: safeRef })
    expect(materializeLargeValueRefMock).toHaveBeenCalledTimes(1)
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('checks every ref preview before deduplicating shared underlying values', async () => {
    const safeRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'string',
      size: 32,
      preview: '{{X}}',
    } as const
    const unsafePreviewRef = {
      ...safeRef,
      preview: '[REDACTED]',
    } as const
    const source = [createSpan({ output: { first: safeRef, second: unsafePreviewRef } })]
    materializeLargeValueRefMock.mockResolvedValue({ value: '{{X}}' })

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'REDACTED', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).not.toHaveBeenCalled()
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('rejects secret-bearing metadata on a duplicate ref before storage-key deduplication', async () => {
    const safeRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'string',
      size: 32,
      preview: '{{X}}',
    } as const
    const refWithExtraMetadata = {
      ...safeRef,
      leaked: 'hidden-EEEEEEEE',
    }
    const source = [createSpan({ output: { first: safeRef, duplicate: refWithExtraMetadata } })]
    materializeLargeValueRefMock.mockResolvedValue({ value: '{{X}}' })

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).not.toHaveBeenCalled()
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('hydrates nested refs found inside a ref preview', async () => {
    const nestedRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_cccccccccccc',
      kind: 'string',
      size: 32,
      preview: '{{X}}',
    } as const
    const outerRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'object',
      size: 64,
      preview: { nested: nestedRef },
    } as const
    const source = [createSpan({ output: { payload: outerRef } })]
    materializeLargeValueRefMock.mockImplementation(async (ref: { id: string }) =>
      ref.id === nestedRef.id ? { value: 'hidden-EEEEEEEE' } : { value: '{{X}}' }
    )

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).toHaveBeenCalledWith(
      nestedRef,
      expect.objectContaining({ trackReference: false })
    )
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('verifies nested preview refs before deduplicating equal storage keys', async () => {
    const nestedRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_cccccccccccc',
      kind: 'string',
      size: 32,
      preview: '{{X}}',
    } as const
    const outerRefWithNestedPreview = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'object',
      size: 64,
      preview: { nested: nestedRef },
    } as const
    const outerRefWithPlainPreview = {
      ...outerRefWithNestedPreview,
      preview: { visible: '{{X}}' },
    } as const
    const source = [
      createSpan({
        output: {
          first: outerRefWithNestedPreview,
          second: outerRefWithPlainPreview,
        },
      }),
    ]
    materializeLargeValueRefMock.mockImplementation(async (ref: { id: string }) =>
      ref.id === nestedRef.id ? { value: 'hidden-EEEEEEEE' } : { value: '{{X}}' }
    )

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).toHaveBeenCalledWith(
      nestedRef,
      expect.objectContaining({ trackReference: false })
    )
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('fails closed when a trace-owned ref contains a secret beyond its preview', async () => {
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'string',
      size: 32,
      preview: '{{X}}',
    } as const
    const source = [createSpan({ output: { payload: ref } })]
    materializeLargeValueRefMock.mockResolvedValue({ visibleAfterPreview: 'value-EEEEEEEE' })

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).toHaveBeenCalledTimes(1)
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('does not double-count manifest chunks against the hydration byte budget', async () => {
    const byteSize = 40 * 1024 * 1024
    const chunkRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_cccccccccccc',
      kind: 'array',
      size: byteSize,
      preview: [{ token: '{{X}}' }],
    } as const
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize,
      chunks: [{ ref: chunkRef, count: 1, byteSize }],
      preview: [{ token: '{{X}}' }],
    } as const
    const source = [createSpan({ output: { items: manifest } })]
    materializeLargeValueRefMock.mockResolvedValue([{ token: '{{X}}' }])

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result).toBe(source)
    expect(materializeLargeValueRefMock).toHaveBeenCalledTimes(1)
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it.each(['ref-first', 'manifest-first'] as const)(
    'charges shared manifest payload refs once with %s property order',
    async (order) => {
      const byteSize = 40 * 1024 * 1024
      const chunkRef = {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_cccccccccccc',
        kind: 'array',
        size: byteSize,
        preview: [{ token: '{{X}}' }],
      } as const
      const manifest = {
        __simLargeArrayManifest: true,
        version: 2,
        kind: 'array',
        totalCount: 1,
        chunkCount: 1,
        byteSize,
        chunks: [{ ref: chunkRef, count: 1, byteSize }],
        preview: [{ token: '{{X}}' }],
      } as const
      const clonedManifest = {
        ...manifest,
        chunks: [{ ...manifest.chunks[0] }],
        preview: [...manifest.preview],
      }
      const output =
        order === 'ref-first'
          ? { direct: chunkRef, manifest, clonedManifest }
          : { manifest, clonedManifest, direct: chunkRef }
      const source = [createSpan({ output })]
      materializeLargeValueRefMock.mockResolvedValue([{ token: '{{X}}' }])

      const result = await enforceTraceSpanSecretInvariant(source, {
        registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
        store: STORE,
      })

      expect(result).toBe(source)
      expect(materializeLargeValueRefMock).toHaveBeenCalledTimes(1)
      expect(storeLargeValueMock).not.toHaveBeenCalled()
    }
  )

  it('fails closed when a trace-owned manifest chunk contains a secret', async () => {
    const chunkRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_cccccccccccc',
      kind: 'array',
      size: 32,
      preview: [{ token: '{{X}}' }],
    } as const
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 32,
      chunks: [{ ref: chunkRef, count: 1, byteSize: 32 }],
      preview: [{ token: '{{X}}' }],
    } as const
    const source = [createSpan({ output: { items: manifest } })]
    materializeLargeValueRefMock.mockResolvedValue([{ token: 'hidden-EEEEEEEE' }])

    const result = await enforceTraceSpanSecretInvariant(source, {
      registry: createRegistry([{ plaintext: 'EEEEEEEE', replacement: '{{X}}' }]),
      store: STORE,
    })

    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).toHaveBeenCalledTimes(1)
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('hydrates and re-stores large values without retaining the source ref', async () => {
    const sourceRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_aaaaaaaaaaaa',
      kind: 'object',
      size: 9_000_000,
    } as const
    const safeRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'object',
      size: 32,
      preview: { keys: ['token'] },
    } as const
    materializeLargeValueRefMock.mockResolvedValue({ token: 'top-secret' })
    storeLargeValueMock.mockResolvedValue(safeRef)

    const result = await projectTraceSpansForSecrets(
      [createSpan({ output: { payload: sourceRef } })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      }
    )

    expect(materializeLargeValueRefMock).toHaveBeenCalledWith(
      sourceRef,
      expect.objectContaining({
        trackReference: false,
        maxBytes: 64 * 1024 * 1024,
      })
    )
    expect(storeLargeValueMock).toHaveBeenCalledWith(
      { token: '{{API_SECRET}}' },
      JSON.stringify({ token: '{{API_SECRET}}' }),
      expect.any(Number),
      expect.objectContaining({ requireDurable: true })
    )
    expect(result[0].output).toEqual({ payload: safeRef })
    expect(result[0].output).not.toEqual({ payload: sourceRef })
  })

  it('omits ref-backed content without reading or writing during display projection', async () => {
    const sourceRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_aaaaaaaaaaaa',
      kind: 'object',
      size: 9_000_000,
    } as const

    const result = await projectTraceSpansForSecrets(
      [createSpan({ input: { safe: true }, output: { payload: sourceRef } })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
        allowLargeValueWrites: false,
      }
    )

    expect(result[0].input).toEqual({ safe: true })
    expect(result[0]).not.toHaveProperty('output')
    expect(materializeLargeValueRefMock).not.toHaveBeenCalled()
    expect(storeLargeValueMock).not.toHaveBeenCalled()
  })

  it('omits only the affected field when a large value cannot be re-stored', async () => {
    const sourceRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_aaaaaaaaaaaa',
      kind: 'object',
      size: 9_000_000,
    } as const
    materializeLargeValueRefMock.mockResolvedValue({ token: 'top-secret' })
    storeLargeValueMock.mockRejectedValue(new Error('storage unavailable'))

    const result = await projectTraceSpansForSecrets(
      [createSpan({ input: { safe: true }, output: { payload: sourceRef } })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      }
    )

    expect(result[0].input).toEqual({ safe: true })
    expect(result[0]).not.toHaveProperty('output')
  })

  it('rewrites manifests chunk-by-chunk and derives a sanitized preview', async () => {
    const chunkRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_aaaaaaaaaaaa',
      kind: 'array',
      size: 64,
    } as const
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 64,
      chunks: [{ ref: chunkRef, count: 1, byteSize: 64 }],
      preview: [{ token: 'top-secret' }],
    } as const
    materializeLargeValueRefMock.mockResolvedValue([{ token: 'top-secret' }])
    storeLargeValueMock.mockImplementation(
      async (_value: unknown, _json: string, size: number) => ({
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_bbbbbbbbbbbb',
        kind: 'array',
        size,
      })
    )

    const result = await projectTraceSpansForSecrets(
      [createSpan({ output: { items: manifest } })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      }
    )

    expect(materializeLargeValueRefMock).toHaveBeenCalledTimes(1)
    const rewritten = result[0].output?.items
    expect(rewritten).toEqual(
      expect.objectContaining({
        __simLargeArrayManifest: true,
        totalCount: 1,
        preview: [{ token: '{{API_SECRET}}' }],
      })
    )
    expect(rewritten).not.toBe(manifest)
  })

  it('stores each sanitized manifest chunk before materializing the next chunk', async () => {
    const sourceRefs = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'].map((suffix) => ({
      __simLargeValueRef: true as const,
      version: 1 as const,
      id: `lv_${suffix}`,
      kind: 'array' as const,
      size: 32,
    }))
    const events: string[] = []
    materializeLargeValueRefMock.mockImplementation(async (ref: { id: string }) => {
      events.push(`materialize:${ref.id}`)
      return [{ token: 'top-secret' }]
    })
    storeLargeValueMock.mockImplementation(async (_value: unknown, _json: string, size: number) => {
      const index = events.filter((event) => event.startsWith('store:')).length
      const id = `lv_safechunk${index.toString().padStart(3, '0')}`
      events.push(`store:${id}`)
      return {
        __simLargeValueRef: true,
        version: 1,
        id,
        kind: 'array',
        size,
      }
    })
    const manifest = {
      __simLargeArrayManifest: true as const,
      version: 2 as const,
      kind: 'array' as const,
      totalCount: 2,
      chunkCount: 2,
      byteSize: 64,
      chunks: sourceRefs.map((ref) => ({ ref, count: 1, byteSize: 32 })),
      preview: [],
    }

    const result = await projectTraceSpansForSecrets(
      [createSpan({ output: { items: manifest } })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      }
    )

    expect(events).toEqual([
      'materialize:lv_aaaaaaaaaaaa',
      'store:lv_safechunk000',
      'materialize:lv_bbbbbbbbbbbb',
      'store:lv_safechunk001',
    ])
    expect(result[0].output?.items).toEqual(
      expect.objectContaining({ chunkCount: 2, totalCount: 2 })
    )
  })

  it('fails closed before sanitized manifest chunks exceed the cumulative output budget', async () => {
    const sourceRefs = Array.from({ length: 70 }, (_, index) => ({
      __simLargeValueRef: true as const,
      version: 1 as const,
      id: `lv_${index.toString().padStart(12, '0')}`,
      kind: 'array' as const,
      size: 1,
    }))
    const expandingSecret = 'a7Kq2Xz9Lm4P'
    const expandedValue = expandingSecret.repeat(1024)
    materializeLargeValueRefMock.mockImplementation(async () => [expandedValue])
    storeLargeValueMock.mockImplementation(
      async (_value: unknown, _json: string, size: number) => ({
        __simLargeValueRef: true,
        version: 1,
        id: `lv_safe${storeLargeValueMock.mock.calls.length.toString().padStart(8, '0')}`,
        kind: 'array',
        size,
      })
    )
    const manifest = {
      __simLargeArrayManifest: true as const,
      version: 2 as const,
      kind: 'array' as const,
      totalCount: sourceRefs.length,
      chunkCount: sourceRefs.length,
      byteSize: sourceRefs.length,
      chunks: sourceRefs.map((ref) => ({ ref, count: 1, byteSize: 1 })),
      preview: [],
    }

    const result = await projectTraceSpansForSecrets(
      [createSpan({ input: { ok: true }, output: { items: manifest } })],
      {
        registry: createRegistry([{ plaintext: expandingSecret, replacement: 'X'.repeat(1024) }]),
        store: STORE,
      }
    )

    expect(storeLargeValueMock).toHaveBeenCalledTimes(63)
    expect(result[0].input).toEqual({ ok: true })
    expect(result[0]).not.toHaveProperty('output')
  })

  it('rejects a manifest when storage reuses one sanitized ref for multiple chunks', async () => {
    const sourceRefs = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'].map((suffix) => ({
      __simLargeValueRef: true as const,
      version: 1 as const,
      id: `lv_${suffix}`,
      kind: 'array' as const,
      size: 32,
    }))
    const reusedRef = {
      __simLargeValueRef: true as const,
      version: 1 as const,
      id: 'lv_reusedref000',
      kind: 'array' as const,
      size: 32,
    }
    materializeLargeValueRefMock.mockResolvedValue([{ token: 'top-secret' }])
    storeLargeValueMock.mockResolvedValue(reusedRef)
    const manifest = {
      __simLargeArrayManifest: true as const,
      version: 2 as const,
      kind: 'array' as const,
      totalCount: 2,
      chunkCount: 2,
      byteSize: 64,
      chunks: sourceRefs.map((ref) => ({ ref, count: 1, byteSize: 32 })),
      preview: [],
    }

    const result = await projectTraceSpansForSecrets(
      [createSpan({ input: { safe: true }, output: { items: manifest } })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      }
    )

    expect(storeLargeValueMock).toHaveBeenCalledTimes(2)
    expect(result[0].input).toEqual({ safe: true })
    expect(result[0]).not.toHaveProperty('output')
  })

  it('does not invoke array map while replacing refs and sanitizing inline content', async () => {
    const sourceRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_aaaaaaaaaaaa',
      kind: 'object',
      size: 32,
    } as const
    const safeRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'object',
      size: 32,
    } as const
    const map = vi.fn(() => {
      throw new Error('array map must not be invoked')
    })
    const values: unknown[] = [sourceRef, 'top-secret']
    Object.defineProperty(values, 'map', { value: map })
    materializeLargeValueRefMock.mockResolvedValue({ token: 'top-secret' })
    storeLargeValueMock.mockResolvedValue(safeRef)

    const result = await projectTraceSpansForSecrets([createSpan({ output: values })], {
      registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
      store: STORE,
    })

    expect(map).not.toHaveBeenCalled()
    expect(result[0].output).toEqual([safeRef, '{{API_SECRET}}'])
  })

  it('omits an oversized sparse content array without allocating its declared length', async () => {
    const sparse: unknown[] = []
    sparse.length = 100_001
    sparse[0] = 'top-secret'

    const [result] = await projectTraceSpansForSecrets(
      [createSpan({ input: { safe: true }, output: sparse })],
      {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      }
    )

    expect(result.input).toEqual({ safe: true })
    expect(result).not.toHaveProperty('output')
  })

  it('caps no-secret structural cloning by depth', async () => {
    let source = createSpan({ id: 'depth-150', output: { safe: true } })
    for (let depth = 149; depth >= 0; depth -= 1) {
      source = createSpan({ id: `depth-${depth}`, children: [source] })
    }

    const [result] = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([]),
      store: STORE,
    })

    let projectedDepth = 0
    let cursor: TraceSpan | undefined = result
    while (cursor?.children?.[0]) {
      projectedDepth += 1
      cursor = cursor.children[0]
    }
    expect(projectedDepth).toBe(100)
    expect(cursor?.children).toEqual([])
  })

  it('caps structural fallback cardinality and strips every retained call argument', async () => {
    const call = { id: 'call-1', name: 'lookup', arguments: { secret: 'raw' } }
    const source = createSpan({
      output: { secret: 'raw' },
      modelToolCalls: Array(100_005).fill(call),
      children: [createSpan({ id: 'unreached-child', output: { secret: 'raw' } })],
    })

    const [result] = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([], false),
      store: STORE,
    })

    expect(result).not.toHaveProperty('output')
    expect(result.modelToolCalls?.length).toBeLessThan(source.modelToolCalls?.length ?? 0)
    expect(result.modelToolCalls?.every((retained) => !Object.hasOwn(retained, 'arguments'))).toBe(
      true
    )
    expect(result.children).toEqual([])
  })

  it('bounds active-path model tool calls with the global structure budget', async () => {
    const call = { id: 'call-1', name: 'lookup', arguments: { secret: 'top-secret' } }
    const source = createSpan({
      output: { secret: 'top-secret' },
      modelToolCalls: Array(100_005).fill(call),
      children: [createSpan({ id: 'unreached-child', output: { secret: 'top-secret' } })],
    })

    const [result] = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
      store: STORE,
    })

    expect(result).not.toHaveProperty('output')
    expect(result.modelToolCalls?.length).toBeLessThan(source.modelToolCalls?.length ?? 0)
    expect(result.modelToolCalls?.every((retained) => !Object.hasOwn(retained, 'arguments'))).toBe(
      true
    )
    expect(result.children).toEqual([])
  })

  it('iterates wide records without bulk property-descriptor materialization', async () => {
    const descriptorSpy = vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation(() => {
      throw new Error('bulk descriptor materialization is forbidden')
    })

    let result: TraceSpan[] = []
    try {
      result = await projectTraceSpansForSecrets(
        [createSpan({ output: { token: 'top-secret' } })],
        {
          registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
          store: STORE,
        }
      )
    } finally {
      descriptorSpy.mockRestore()
    }

    expect(result[0].output).toEqual({ token: '{{API_SECRET}}' })
  })

  it('names the invariant that forced content to be omitted', async () => {
    const output: Record<string, unknown> = { token: 'top-secret' }
    output.self = output

    const [result] = await projectTraceSpansForSecrets([createSpan({ output })], {
      registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
      store: STORE,
    })

    expect(result).not.toHaveProperty('output')
    expect(warnMock).toHaveBeenCalledWith('Omitting trace content that could not be sanitized', {
      failure: {
        name: 'TraceSecretProjectionError',
        reason: 'Trace content could not be sanitized',
      },
    })
  })

  it('withholds the message of a failure raised outside the projection module', async () => {
    const descriptorSpy = vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation(() => {
      throw new SyntaxError('Unexpected token in "sk-live-top-secret"')
    })

    try {
      await projectTraceSpansForSecrets([createSpan({ output: { token: 'top-secret' } })], {
        registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
        store: STORE,
      })
    } finally {
      descriptorSpy.mockRestore()
    }

    expect(warnMock).toHaveBeenCalledWith('Omitting trace content that could not be sanitized', {
      failure: { name: 'SyntaxError' },
    })
  })

  it('names the invariant that forced the whole-tree structural fallback', async () => {
    const source = Array(MAX_CONTENT_NODES + 1).fill(
      createSpan({ output: { token: 'top-secret' } })
    )

    await projectTraceSpansForSecrets(source, {
      registry: createRegistry([{ plaintext: 'top-secret', replacement: '{{API_SECRET}}' }]),
      store: STORE,
    })

    expect(warnMock).toHaveBeenCalledWith(
      'Trace secret projection failed; retaining structural spans only',
      {
        failure: {
          name: 'TraceSecretProjectionError',
          reason: 'Trace structure array exceeds the projection limit',
        },
      }
    )
  })

  it('uses bounded structural fallback when matcher construction fails', async () => {
    let source = createSpan({ id: 'depth-150', output: { secret: 'raw' } })
    for (let depth = 149; depth >= 0; depth -= 1) {
      source = createSpan({ id: `depth-${depth}`, children: [source] })
    }

    const [result] = await projectTraceSpansForSecrets([source], {
      registry: createRegistry([
        { plaintext: 's'.repeat(64 * 1024 + 1), replacement: '{{TOO_LARGE}}' },
      ]),
      store: STORE,
    })

    let projectedDepth = 0
    let cursor: TraceSpan | undefined = result
    while (cursor?.children?.[0]) {
      expect(cursor).not.toHaveProperty('output')
      projectedDepth += 1
      cursor = cursor.children[0]
    }
    expect(projectedDepth).toBe(100)
    expect(cursor).not.toHaveProperty('output')
    expect(cursor?.children).toEqual([])
  })
})
