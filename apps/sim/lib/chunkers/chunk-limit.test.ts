/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { ChunkLimitExceededError } from '@/lib/chunkers/chunk-budget'
import { JsonYamlChunker } from '@/lib/chunkers/json-yaml-chunker'
import { RecursiveChunker } from '@/lib/chunkers/recursive-chunker'
import { RegexChunker } from '@/lib/chunkers/regex-chunker'
import { SentenceChunker } from '@/lib/chunkers/sentence-chunker'
import { StructuredDataChunker } from '@/lib/chunkers/structured-data-chunker'
import { TextChunker } from '@/lib/chunkers/text-chunker'
import { TokenChunker } from '@/lib/chunkers/token-chunker'

const LIMIT_CASES = [
  {
    name: 'text',
    run: () =>
      new TextChunker({ chunkSize: 1, maxChunks: 2 }).chunk(
        'alpha bravo charlie delta echo foxtrot'
      ),
  },
  {
    name: 'token',
    run: () =>
      new TokenChunker({ chunkSize: 1, maxChunks: 2 }).chunk(
        'alpha bravo charlie delta echo foxtrot'
      ),
  },
  {
    name: 'sentence',
    run: () =>
      new SentenceChunker({ chunkSize: 2, maxChunks: 2 }).chunk(
        'Alpha bravo. Charlie delta. Echo foxtrot. Golf hotel.'
      ),
  },
  {
    name: 'recursive',
    run: () =>
      new RecursiveChunker({ chunkSize: 1, maxChunks: 2, separators: ['|'] }).chunk(
        'alpha|bravo|charlie|delta'
      ),
  },
  {
    name: 'regex',
    run: () =>
      new RegexChunker({
        pattern: '---',
        strictBoundaries: true,
        chunkSize: 100,
        maxChunks: 2,
      }).chunk('alpha---bravo---charlie---delta'),
  },
  {
    name: 'structured data',
    run: () =>
      StructuredDataChunker.chunkStructuredData(
        [
          'name,value',
          ...Array.from({ length: 16 }, (_, index) => `row-${index},value-${index}`),
        ].join('\n'),
        { chunkSize: 1, maxChunks: 2 }
      ),
  },
  {
    name: 'JSON/YAML',
    run: () =>
      new JsonYamlChunker({ chunkSize: 1, maxChunks: 2 }).chunk(
        JSON.stringify(['alpha', 'bravo', 'charlie', 'delta'])
      ),
  },
] as const

describe('chunk production ceiling', () => {
  it.each(LIMIT_CASES)('$name chunker stops before producing a third chunk', async ({ run }) => {
    await expect(run()).rejects.toBeInstanceOf(ChunkLimitExceededError)
  })

  it('does not retain budget usage across calls on one chunker instance', async () => {
    const chunker = new TokenChunker({ chunkSize: 100, maxChunks: 1 })

    await expect(chunker.chunk('first document')).resolves.toHaveLength(1)
    await expect(chunker.chunk('second document')).resolves.toHaveLength(1)
  })

  it('admits the exact limit when a short trailing token chunk is filtered out', async () => {
    const chunker = new TokenChunker({
      chunkSize: 1,
      minCharactersPerChunk: 4,
      maxChunks: 2,
    })

    await expect(chunker.chunk('aaaa aaaa x')).resolves.toHaveLength(2)
  })

  it('stops separator-heavy text production at the configured ceiling', async () => {
    const content = Array.from({ length: 50_000 }, () => 'x').join(' ')
    const chunker = new TextChunker({ chunkSize: 1, maxChunks: 2 })

    await expect(chunker.chunk(content)).rejects.toBeInstanceOf(ChunkLimitExceededError)
  })

  it('stops strict-regex splitting without materializing every remaining segment', async () => {
    const content = Array.from({ length: 50_000 }, () => 'x').join('---')
    const chunker = new RegexChunker({
      pattern: '---',
      strictBoundaries: true,
      chunkSize: 100,
      maxChunks: 2,
    })

    await expect(chunker.chunk(content)).rejects.toBeInstanceOf(ChunkLimitExceededError)
  })
})
