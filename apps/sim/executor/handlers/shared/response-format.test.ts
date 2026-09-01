/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseResponseFormat } from '@/executor/handlers/shared/response-format'

const mockLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'SharedResponseFormat')
  ].value

describe('parseResponseFormat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs only structural metadata when resolved input is invalid JSON', () => {
    const plaintext = 'response-format-plaintext-secret'
    const responseFormat = `{"description":"${plaintext} __var_API_KEY __sim_runtime"`

    expect(parseResponseFormat(responseFormat)).toBeUndefined()

    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to parse response format as JSON', {
      errorName: 'SyntaxError',
      responseFormatType: 'string',
      responseFormatLength: responseFormat.length,
    })
    const logged = JSON.stringify(mockLogger.warn.mock.calls)
    expect(logged).not.toContain(plaintext)
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
  })
})
