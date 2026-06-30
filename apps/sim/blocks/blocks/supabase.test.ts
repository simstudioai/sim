/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SupabaseBlock } from '@/blocks/blocks/supabase'

describe('SupabaseBlock', () => {
  const buildParams = SupabaseBlock.tools.config.params!
  const selectTool = SupabaseBlock.tools.config.tool!

  it('maps each operation to its tool id', () => {
    expect(selectTool({ operation: 'query' })).toBe('supabase_query')
    expect(selectTool({ operation: 'invoke_function' })).toBe('supabase_invoke_function')
    expect(selectTool({ operation: 'delete' })).toBe('supabase_delete')
  })

  it('does not leak the Edge Function method onto other operations', () => {
    // A stale `method` from the Edge Function field must never reach a tool with a
    // static verb — otherwise the executor would let it override e.g. GET with DELETE.
    const params = buildParams({
      operation: 'query',
      projectId: 'proj',
      apiKey: 'key',
      table: 'users',
      method: 'DELETE',
    })

    expect(params).not.toHaveProperty('method')
    expect(params).not.toHaveProperty('body')
    expect(params).not.toHaveProperty('headers')
  })

  it('ignores stale invalid Edge Function fields on other operations', () => {
    // Hidden Edge Function inputs left over from a prior selection must not be
    // parsed/validated (and must never throw) for unrelated operations.
    expect(() =>
      buildParams({
        operation: 'query',
        projectId: 'proj',
        apiKey: 'key',
        table: 'users',
        functionBody: '{not valid json',
        functionHeaders: '["a","b"]',
      })
    ).not.toThrow()
  })

  it('passes method, body, and headers through for invoke_function', () => {
    const params = buildParams({
      operation: 'invoke_function',
      projectId: 'proj',
      apiKey: 'key',
      functionName: 'hello-world',
      method: 'POST',
      functionBody: '{"name":"world"}',
      functionHeaders: '{"x-trace":"1"}',
    })

    expect(params.method).toBe('POST')
    expect(params.body).toEqual({ name: 'world' })
    expect(params.headers).toEqual({ 'x-trace': '1' })
  })

  it('rejects non-object Edge Function headers', () => {
    expect(() =>
      buildParams({
        operation: 'invoke_function',
        projectId: 'proj',
        apiKey: 'key',
        functionName: 'hello-world',
        functionHeaders: '["a","b"]',
      })
    ).toThrow('Edge Function headers must be a JSON object')
  })
})
