/**
 * Catalog lookups grow linearly with the block (see `growth` for how a case is measured).
 */

import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, it } from 'vitest'
import { TEST_CATALOG } from '../compile/catalog.test-helpers'
import { buildFieldIndex } from './surface'
import type { CatalogBlock, CatalogSubBlock } from './types'
import { catalogBlock } from './view'

/** A block of `pairs` basic/advanced pairs, like a large integration's credential and id pickers. */
function pairedBlock(pairs: number): CatalogBlock {
  const api = catalogBlock(TEST_CATALOG, 'api')
  if (!api) throw new Error('expected the api block')
  const subBlocks: CatalogSubBlock[] = []
  for (let i = 0; i < pairs; i += 1) {
    const member: Pick<CatalogSubBlock, 'type' | 'valueKind' | 'storage'> = {
      type: 'short-input',
      valueKind: 'string',
      storage: 'native',
    }
    subBlocks.push({ ...member, id: `basic${i}`, canonicalParamId: `param${i}` })
    subBlocks.push({
      ...member,
      id: `advanced${i}`,
      canonicalParamId: `param${i}`,
      mode: 'advanced',
    })
  }
  return { ...api, type: 'paired', subBlocks }
}

describe('catalog scaling', () => {
  it('indexes the fields of a block with many basic/advanced pairs in linear time', () => {
    expectLinearGrowth((n) => () => buildFieldIndex(pairedBlock(n), false, new Set()), 1_000)
  })
})
