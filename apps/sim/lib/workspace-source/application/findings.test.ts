/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findingIdentity } from '@/lib/workspace-source/application/findings'

const UNKNOWN_ENV = {
  code: 'W_ENV_UNKNOWN',
  severity: 'warning',
  message: 'env.QA_NOT_SET is not set in this workspace.',
} as const

describe('findingIdentity', () => {
  it('matches a write finding to its plan finding by block key, whatever id the write gave the block', () => {
    expect(findingIdentity({ ...UNKNOWN_ENV, blockKey: 'save', blockId: 'blk_new' })).toBe(
      findingIdentity({ ...UNKNOWN_ENV, blockKey: 'save' })
    )
  })

  it('keeps apart findings that name different blocks only by id', () => {
    expect(findingIdentity({ ...UNKNOWN_ENV, blockId: 'blk_a' })).not.toBe(
      findingIdentity({ ...UNKNOWN_ENV, blockId: 'blk_b' })
    )
  })
})
