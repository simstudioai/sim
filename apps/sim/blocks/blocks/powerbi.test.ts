import { describe, expect, it } from 'vitest'
import { PowerBIBlock } from '@/blocks/blocks/powerbi'

/** Runs the mapper the way an agent tool call does: its output spreads over the merged params. */
function runToolCall(args: Record<string, unknown>, operation: string) {
  const mapper = PowerBIBlock.tools.config?.params
  if (!mapper) throw new Error('Power BI block has no params mapper')
  return { ...args, ...mapper(args, { operation }) }
}

describe('PowerBIBlock tool-call params', () => {
  it('keeps and coerces the model list arguments when the operation arrives only in context', () => {
    const params = runToolCall(
      { top: '25', skip: 5, filter: "contains(name,'Sales')" },
      'powerbi_list_workspaces'
    )

    expect(params).toMatchObject({ top: 25, skip: 5, filter: "contains(name,'Sales')" })
  })
})
