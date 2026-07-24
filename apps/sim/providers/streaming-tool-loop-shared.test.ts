/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseToolArguments } from '@/providers/streaming-tool-loop-shared'

describe('parseToolArguments', () => {
  it('returns JSON objects', () => {
    expect(parseToolArguments('{"query":"sim"}', 'search')).toEqual({ query: 'sim' })
  })

  it.each(['null', '[]', '"text"', '0', 'false'])(
    'rejects non-object JSON arguments: %s',
    (argumentsJson) => {
      expect(() => parseToolArguments(argumentsJson, 'search')).toThrow(
        'Arguments for tool "search" must be a JSON object'
      )
    }
  )

  it('rejects malformed JSON with the tool name', () => {
    expect(() => parseToolArguments('{"query":', 'search')).toThrow(
      'Invalid JSON arguments for tool "search"'
    )
  })
})
