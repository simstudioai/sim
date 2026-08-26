/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertValidCustomToolDeclaration,
  isValidCustomToolDeclaration,
} from '@/lib/custom-tools/schema'

function declaration(overrides: {
  name?: string
  parametersType?: string
}): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: overrides.name ?? 'lookup_order',
      description: 'Look an order up',
      parameters: {
        type: overrides.parametersType ?? 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }
}

describe('assertValidCustomToolDeclaration', () => {
  it('accepts a declaration a provider can carry', () => {
    expect(() => assertValidCustomToolDeclaration(declaration({}))).not.toThrow()
    expect(() =>
      assertValidCustomToolDeclaration(declaration({ name: 'lookup-order-2' }))
    ).not.toThrow()
  })

  it.each(['has spaces!', 'ünïcode', 'dots.in.name', 'a'.repeat(65)])(
    'refuses the unusable function name %j',
    (name) => {
      expect(() => assertValidCustomToolDeclaration(declaration({ name }))).toThrow(
        /function\.name/
      )
    }
  )

  it('refuses a parameters type that is not an object', () => {
    expect(() =>
      assertValidCustomToolDeclaration(declaration({ parametersType: 'banana' }))
    ).toThrow(/function\.parameters\.type/)
  })

  it('still refuses a declaration the response cannot publish', () => {
    expect(() => assertValidCustomToolDeclaration({ type: 'function' })).toThrow(
      /Invalid custom tool schema/
    )
  })

  it('reports the same verdict as a predicate', () => {
    expect(isValidCustomToolDeclaration(declaration({}))).toBe(true)
    expect(isValidCustomToolDeclaration(declaration({ name: 'has spaces!' }))).toBe(false)
    expect(isValidCustomToolDeclaration(declaration({ parametersType: 'banana' }))).toBe(false)
  })
})
