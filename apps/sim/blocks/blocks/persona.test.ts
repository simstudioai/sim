import { describe, expect, it } from 'vitest'
import { PersonaBlock } from '@/blocks/blocks/persona'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = PersonaBlock.tools.config?.params
  if (!mapper) throw new Error('Persona block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('Persona tool calls', () => {
  it('normalizes the stored CSV file on Import Accounts', () => {
    const file = { name: 'accounts.csv', key: 'workspace/accounts.csv', size: 10 }
    const result = mapParams(
      { apiKey: 'k', file: JSON.stringify(file) },
      { operation: 'import_accounts' }
    )
    expect(result.file).toEqual(file)
  })
})
