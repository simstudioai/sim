import { SOURCE_LIMITS } from '@sim/workflow-code/limits'
import { describe, expect, it } from 'vitest'
import { workflowLockSchema } from '@/lib/api/contracts/workflow-source'

function lockOf(blockCount: number, variableCount: number) {
  const blocks: Record<string, unknown> = {}
  const variables: Record<string, string> = {}
  for (let i = 0; i < blockCount; i += 1) {
    blocks[`b${i}`] = { id: `id${i}`, parent: null, ident: `b${i}`, order: i }
  }
  for (let i = 0; i < variableCount; i += 1) variables[`v${i}`] = `var${i}`
  return { version: 1, blocks, variables }
}

describe('workflowLockSchema', () => {
  it('accepts a lock at the block and variable cap', () => {
    const max = SOURCE_LIMITS.maxBlocks
    expect(workflowLockSchema.safeParse(lockOf(max, max)).success).toBe(true)
  })

  it('refuses a lock with more blocks or variables than a workflow may hold', () => {
    const over = SOURCE_LIMITS.maxBlocks + 1
    const blocks = workflowLockSchema.safeParse(lockOf(over, 0))
    const variables = workflowLockSchema.safeParse(lockOf(0, over))
    expect(blocks.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['blocks'])
    expect(variables.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['variables'])
  })
})
