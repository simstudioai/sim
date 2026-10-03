import { describe, expect, it } from 'vitest'
import { assertValidCustomToolDeclaration } from '@/lib/custom-tools/schema'

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
})
