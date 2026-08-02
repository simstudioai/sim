/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FunctionExecute, RunCode } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  projectToolResultForCopilot,
  TOOL_RESULT_OMITTED_ERROR,
} from '@/lib/copilot/request/tools/resolved-secret-result'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function createRegistry(): ResolvedSecretTraceRegistry {
  return new ResolvedSecretTraceRegistry([
    {
      name: 'SECRET',
      plaintext: 'secret-value',
      encryptedValue: 'encrypted-secret-value',
    },
  ])
}

describe('projectToolResultForCopilot', () => {
  it.each([FunctionExecute.id, RunCode.id])(
    'projects active exact and embedded secrets for %s without mutating runtime output',
    (toolName) => {
      const registry = createRegistry()
      registry.recordResolved('SECRET', 'secret-value')
      const runtimeResult = {
        success: true,
        output: {
          result: 'secret-value',
          stdout: 'prefix-secret-value-suffix',
          values: ['safe', 'secret-value'],
        },
      }
      const runtimeSnapshot = structuredClone(runtimeResult)

      expect(projectToolResultForCopilot(runtimeResult, registry)).toEqual({
        success: true,
        output: {
          result: '{{SECRET}}',
          stdout: 'prefix-{{SECRET}}-suffix',
          values: ['safe', '{{SECRET}}'],
        },
      })
      expect(runtimeResult).toEqual(runtimeSnapshot)
    }
  )

  it('projects both output and error from a failed Function execution', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value')

    expect(
      projectToolResultForCopilot(
        {
          success: false,
          output: { stdout: 'printed secret-value' },
          error: 'Function failed near secret-value',
        },
        registry
      )
    ).toEqual({
      success: false,
      output: { stdout: 'printed {{SECRET}}' },
      error: 'Function failed near {{SECRET}}',
    })
  })

  it('projects secret-bearing object keys and omits content when replacement collides', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value')

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: { 'prefix-secret-value': 'safe' },
        },
        registry
      )
    ).toEqual({
      success: true,
      output: { 'prefix-{{SECRET}}': 'safe' },
    })

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: { 'secret-value': 'first', '{{SECRET}}': 'second' },
        },
        registry
      )
    ).toEqual({
      success: true,
    })
  })

  it('omits content when one replacement creates another active literal', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'MIDDLE', plaintext: 'B', encryptedValue: 'encrypted-b' },
      { name: 'BRACE', plaintext: '{', encryptedValue: 'encrypted-brace' },
      { name: 'JOINED', plaintext: 'ac', encryptedValue: 'encrypted-ac' },
    ])
    registry.recordResolved('MIDDLE', 'B')
    registry.recordResolved('BRACE', '{')
    registry.recordResolved('JOINED', 'ac')

    expect(projectToolResultForCopilot({ success: true, output: 'aBc' }, registry)).toEqual({
      success: true,
    })
  })

  it('keeps the control error safe from active one-character values', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'F_SECRET', plaintext: 'F', encryptedValue: 'encrypted-f' },
    ])
    registry.recordResolved('F_SECRET', 'F')

    const projected = projectToolResultForCopilot(
      {
        success: false,
        output: { F: 'first', '': 'second' },
        error: 'F',
      },
      registry
    )

    expect(projected.success).toBe(false)
    expect(projected).not.toHaveProperty('output')
    expect(projected.error).toBeTruthy()
    expect(projected.error).not.toContain('F')
  })

  it('does not project transformed values', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value')
    const encoded = Buffer.from('secret-value').toString('base64')

    expect(
      projectToolResultForCopilot({ success: true, output: { result: encoded } }, registry)
    ).toEqual({ success: true, output: { result: encoded } })
  })

  it('leaves configured but unused values unchanged', () => {
    const registry = createRegistry()
    const result = {
      success: true,
      output: { result: 'secret-value', stdout: '' },
    }

    expect(projectToolResultForCopilot(result, registry)).toEqual(result)
  })

  it.each([
    ['missing', undefined],
    [
      'incomplete',
      (() => {
        const registry = createRegistry()
        registry.markIncomplete()
        return registry
      })(),
    ],
  ])('fails closed for %s provenance without changing structural fields', (_label, registry) => {
    expect(
      projectToolResultForCopilot(
        {
          success: false,
          output: { result: 'possibly-secret' },
          error: 'possibly-secret-error',
          resources: [{ type: 'file', id: 'file-1', title: 'report.txt' }],
        },
        registry
      )
    ).toEqual({
      success: false,
      error: TOOL_RESULT_OMITTED_ERROR,
    })
  })

  it('projects Copilot-visible resource metadata without changing the runtime result', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value')
    const result = {
      success: true,
      resources: [{ type: 'file' as const, id: 'file-secret-value', title: 'secret-value.txt' }],
    }

    expect(projectToolResultForCopilot(result, registry)).toEqual({
      success: true,
      resources: [{ type: 'file', id: 'file-secret-value', title: '{{SECRET}}.txt' }],
    })
    expect(result.resources[0]).toEqual({
      type: 'file',
      id: 'file-secret-value',
      title: 'secret-value.txt',
    })
  })

  it('projects every tool result once provenance is active', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value')
    const result = { success: true, output: 'secret-value' }

    expect(projectToolResultForCopilot(result, registry)).toEqual({
      success: true,
      output: '{{SECRET}}',
    })
    expect(result).toEqual({ success: true, output: 'secret-value' })
  })

  it('omits every tool result when no trusted provenance registry exists', () => {
    expect(
      projectToolResultForCopilot({ success: true, output: 'possibly-secret' }, undefined)
    ).toEqual({ success: true })
  })
})
