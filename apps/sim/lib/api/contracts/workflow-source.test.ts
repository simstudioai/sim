import { SOURCE_LIMITS } from '@sim/workflow-code/limits'
import { describe, expect, it } from 'vitest'
import { workflowLockSchema } from '@/lib/api/contracts/workflow-source'

function lockOf(blockCount: number, variableCount: number, valid = true) {
  const blocks: Record<string, unknown> = {}
  const variables: Record<string, unknown> = {}
  for (let i = 0; i < blockCount; i += 1) {
    blocks[`b${i}`] = valid ? { id: `id${i}`, parent: null, ident: `b${i}`, order: i } : { id: i }
  }
  for (let i = 0; i < variableCount; i += 1) variables[`v${i}`] = valid ? `var${i}` : i
  return { version: 1, blocks, variables }
}

function issuePaths(lock: unknown): string[] | undefined {
  return workflowLockSchema.safeParse(lock).error?.issues.map((issue) => issue.path.join('.'))
}

describe('workflowLockSchema', () => {
  it('accepts a lock at the block and variable cap', () => {
    const lock = lockOf(SOURCE_LIMITS.maxBlocks, SOURCE_LIMITS.maxVariables)
    expect(workflowLockSchema.safeParse(lock).success).toBe(true)
  })

  it('refuses a lock with more blocks or variables than a workflow may hold, before reading them', () => {
    // Every entry is malformed, so a schema that validated them first would report each one.
    expect(issuePaths(lockOf(SOURCE_LIMITS.maxBlocks + 1, 0, false))).toEqual(['blocks'])
    expect(issuePaths(lockOf(0, SOURCE_LIMITS.maxVariables + 1, false))).toEqual(['variables'])
  })
})
