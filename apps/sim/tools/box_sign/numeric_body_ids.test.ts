/**
 * @vitest-environment node
 *
 * Guards `box_sign_create_request`'s `sourceFileIds` against arriving as a JSON
 * number.
 *
 * The parameter is documented as a comma-separated list, but Box file ids are
 * numeric strings, so the single-file case is a bare `12345` — and an LLM
 * filling a `visibility: 'user-or-llm'` slot with one id has no reason to quote
 * it. `params.sourceFileIds.split(',')` on a number is an unhandled
 * `TypeError: x.split is not a function`, surfaced as a tool crash rather than
 * a validation error.
 */
import { describe, expect, it } from 'vitest'
import { boxSignCreateRequestTool } from '@/tools/box_sign/create_request'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

function bodyOf(params: Record<string, unknown>): Record<string, any> {
  const build = (boxSignCreateRequestTool as AnyTool).request.body as (
    p: Record<string, unknown>
  ) => Record<string, any>
  return build({ accessToken: 'TOKEN', signerEmail: 'a@example.com', ...params })
}

describe('box_sign_create_request sourceFileIds coercion', () => {
  it('accepts a single numeric file id emitted as a JSON number', () => {
    expect(bodyOf({ sourceFileIds: 12345 }).source_files).toEqual([{ type: 'file', id: '12345' }])
  })

  it('still splits and trims a comma-separated string byte-identically', () => {
    expect(bodyOf({ sourceFileIds: ' 1, 2 ,3 , ' }).source_files).toEqual([
      { type: 'file', id: '1' },
      { type: 'file', id: '2' },
      { type: 'file', id: '3' },
    ])
  })

  it('reports a missing required id list by name rather than crashing', () => {
    expect(() => bodyOf({})).toThrow(/sourceFileIds/)
  })
})
