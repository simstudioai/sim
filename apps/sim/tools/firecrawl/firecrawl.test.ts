/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'

describe('firecrawl block input declarations', () => {
  it('declares every configurable subBlock in the inputs map', () => {
    const declared = new Set(Object.keys(FirecrawlBlock.inputs ?? {}))
    const undeclared = FirecrawlBlock.subBlocks
      .map((subBlock) => subBlock.canonicalParamId ?? subBlock.id)
      .filter((paramId) => !declared.has(paramId))

    expect([...new Set(undeclared)]).toEqual([])
  })
})
