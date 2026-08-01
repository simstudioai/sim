/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ROUND_FILE_BYTES,
  MAX_ROUND_REPLY_LENGTH,
  MAX_THREADS_PER_ROUND,
  parseBabysitRound,
} from '@/executor/handlers/pi/babysit-round'

const allowed = new Set(['thread-1', 'thread-2'])

function parse(value: unknown, options: { commitPushed?: boolean; secrets?: string[] } = {}) {
  return parseBabysitRound(JSON.stringify(value), {
    allowedThreadIds: allowed,
    secrets: options.secrets ?? [],
    commitPushed: options.commitPushed ?? true,
  })
}

describe('parseBabysitRound', () => {
  it('accepts the strict contract and reports omitted threads', () => {
    const result = parse({
      threads: [
        {
          threadId: 'thread-1',
          classification: 'false_positive',
          reply: 'This is not reachable.',
        },
      ],
      summary: 'Reviewed it.',
    })

    expect(result.threads).toEqual([
      expect.objectContaining({ threadId: 'thread-1', resolvable: true }),
    ])
    expect(result.omittedThreadIds).toEqual(['thread-2'])
  })

  it('rejects malformed JSON and extra properties', () => {
    expect(() =>
      parseBabysitRound('{', {
        allowedThreadIds: allowed,
        secrets: [],
        commitPushed: true,
      })
    ).toThrow(/valid JSON/)
    expect(() => parse({ threads: [], surprise: true })).toThrow(/invalid/)
  })

  it('rejects unknown and duplicate thread ids', () => {
    expect(() =>
      parse({
        threads: [{ threadId: 'other', classification: 'already_addressed', reply: 'No.' }],
      })
    ).toThrow(/not fetched/)
    expect(() =>
      parse({
        threads: [
          { threadId: 'thread-1', classification: 'already_addressed', reply: 'One.' },
          { threadId: 'thread-1', classification: 'false_positive', reply: 'Two.' },
        ],
      })
    ).toThrow(/duplicated/)
  })

  it('scrubs secrets from public replies and summaries', () => {
    const result = parse(
      {
        threads: [
          {
            threadId: 'thread-1',
            classification: 'already_addressed',
            reply: 'Do not show sk-secret',
          },
        ],
        summary: 'also sk-secret',
      },
      { secrets: ['sk-secret'] }
    )

    expect(result.threads[0].reply).toBe('Do not show ***')
    expect(result.summary).toBe('also ***')
  })

  it('leaves fixed-without-commit threads unresolved and records the violation', () => {
    const result = parse(
      {
        threads: [{ threadId: 'thread-1', classification: 'fixed', reply: 'Fixed.' }],
      },
      { commitPushed: false }
    )

    expect(result.threads[0].resolvable).toBe(false)
    expect(result.contractViolations[0]).toMatch(/without a pushed commit/)
  })

  it('enforces reply, item and file-size limits', () => {
    expect(() =>
      parse({
        threads: [
          {
            threadId: 'thread-1',
            classification: 'fixed',
            reply: 'x'.repeat(MAX_ROUND_REPLY_LENGTH + 1),
          },
        ],
      })
    ).toThrow(/invalid/)
    expect(() =>
      parse({
        threads: Array.from({ length: MAX_THREADS_PER_ROUND + 1 }, (_, index) => ({
          threadId: `thread-${index}`,
          classification: 'fixed',
          reply: 'x',
        })),
      })
    ).toThrow(/invalid/)
    expect(() =>
      parseBabysitRound(' '.repeat(MAX_ROUND_FILE_BYTES + 1), {
        allowedThreadIds: allowed,
        secrets: [],
        commitPushed: true,
      })
    ).toThrow(/exceeds/)
  })
})
