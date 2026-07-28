/**
 * @vitest-environment node
 */

import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import {
  parseReviewComments,
  parseReviewFindings,
  REVIEW_BODY_MAX_LENGTH,
  REVIEW_COMMENT_MAX_COUNT,
  reviewFindingsSchema,
} from '@/tools/github/review-schema'

describe('GitHub review schema', () => {
  it('accepts summary-only and valid multiline findings', () => {
    expect(parseReviewFindings({ body: 'Summary' })).toEqual({ body: 'Summary', comments: [] })
    expect(
      parseReviewFindings({
        body: ' Review summary ',
        comments: [
          {
            path: 'src/a.ts',
            body: ' Tighten this branch ',
            line: 12,
            side: 'RIGHT',
            start_line: 10,
            start_side: 'RIGHT',
          },
        ],
      })
    ).toEqual({
      body: 'Review summary',
      comments: [
        {
          path: 'src/a.ts',
          body: 'Tighten this branch',
          line: 12,
          side: 'RIGHT',
          start_line: 10,
          start_side: 'RIGHT',
        },
      ],
    })
  })

  it.each([
    { body: '' },
    { body: '   ' },
    { body: 'x', comments: null },
    { body: 'x', extra: true },
    { body: 'x'.repeat(REVIEW_BODY_MAX_LENGTH + 1) },
    {
      body: 'x',
      comments: Array.from({ length: REVIEW_COMMENT_MAX_COUNT + 1 }, () => ({
        path: 'a.ts',
        body: 'x',
        line: 1,
        side: 'RIGHT',
      })),
    },
  ])('rejects malformed findings %#', (value) => {
    expect(() => parseReviewFindings(value)).toThrow()
  })

  it.each(['12', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid line value %s when called with unnormalized input',
    (line) => {
      expect(() => parseReviewComments([{ path: 'a.ts', body: 'x', line, side: 'RIGHT' }])).toThrow(
        /comments is invalid/
      )
    }
  )

  it('normalizes numeric strings on the Pi TypeBox validation path', () => {
    const findings = {
      body: 'Summary',
      comments: [{ path: 'a.ts', body: 'Finding', line: '12', side: 'RIGHT' }],
    }

    Value.Convert(reviewFindingsSchema, findings)

    expect(parseReviewFindings(findings)).toEqual({
      body: 'Summary',
      comments: [{ path: 'a.ts', body: 'Finding', line: 12, side: 'RIGHT' }],
    })
  })

  it('requires explicit sides and complete, ordered multiline coordinates', () => {
    expect(() => parseReviewComments([{ path: 'a.ts', body: 'x', line: 2 }])).toThrow(/side/)
    expect(() =>
      parseReviewComments([{ path: 'a.ts', body: 'x', line: 3, side: 'RIGHT', start_line: 1 }])
    ).toThrow(/comments is invalid/)
    expect(() =>
      parseReviewComments([
        {
          path: 'a.ts',
          body: 'x',
          line: 3,
          side: 'RIGHT',
          start_side: 'RIGHT',
        },
      ])
    ).toThrow(/comments is invalid/)
    expect(() =>
      parseReviewComments([
        {
          path: 'a.ts',
          body: 'x',
          line: 3,
          side: 'RIGHT',
          start_line: 3,
          start_side: 'RIGHT',
        },
      ])
    ).toThrow(/must be less than/)
  })

  it('rejects blank fields and unknown comment properties', () => {
    expect(() => parseReviewComments([{ path: ' ', body: 'x', line: 1, side: 'RIGHT' }])).toThrow(
      /leading or trailing whitespace/
    )
    expect(() =>
      parseReviewComments([{ path: 'a.ts', body: ' ', line: 1, side: 'RIGHT' }])
    ).toThrow(/body must not be blank/)
    expect(() =>
      parseReviewComments([{ path: 'a.ts', body: 'x', line: 1, side: 'RIGHT', position: 4 }])
    ).toThrow(/additional properties/)
  })

  it('requires canonical paths and keeps multiline ranges on one side', () => {
    expect(() =>
      parseReviewComments([{ path: './a.ts', body: 'x', line: 1, side: 'RIGHT' }])
    ).toThrow(/canonical repository-relative path/)
    expect(() =>
      parseReviewComments([
        {
          path: 'a.ts',
          body: 'x',
          line: 3,
          side: 'RIGHT',
          start_line: 1,
          start_side: 'LEFT',
        },
      ])
    ).toThrow(/must stay on one diff side/)
  })
})
