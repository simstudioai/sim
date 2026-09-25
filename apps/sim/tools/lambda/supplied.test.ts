import { describe, expect, it } from 'vitest'
import { getFunctionTool } from '@/tools/lambda/get_function'
import { listFunctionsTool } from '@/tools/lambda/list_functions'
import { isSupplied } from '@/tools/lambda/supplied'

describe('isSupplied', () => {
  it('treats undefined, null, and the empty string as not supplied', () => {
    expect(isSupplied(undefined)).toBe(false)
    expect(isSupplied(null)).toBe(false)
    expect(isSupplied('')).toBe(false)
  })

  it('treats falsy-but-real values as supplied', () => {
    expect(isSupplied(0)).toBe(true)
    expect(isSupplied(false)).toBe(true)
    expect(isSupplied([])).toBe(true)
  })
})

const CONNECTION = {
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'AKIA',
  awsSecretAccessKey: 'secret',
}

describe('Lambda tool operation input', () => {
  it('omits an optional param that arrived as an empty string or null', () => {
    const input = getFunctionTool.operation?.input?.({
      ...CONNECTION,
      functionName: 'alpha',
      qualifier: '',
    }) as Record<string, unknown>

    expect(input).not.toHaveProperty('qualifier')
  })

  it('keeps an explicit zero rather than treating it as absent', () => {
    const input = listFunctionsTool.operation?.input?.({
      ...CONNECTION,
      maxItems: 0,
    }) as Record<string, unknown>

    expect(input.maxItems).toBe(0)
  })
})
