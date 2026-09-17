/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  beginListingCheckpoint,
  readListingCheckpoint,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import { listingFailuresSchema } from '@/connectors/listing-failures'
import { CONNECTOR_SOURCE_REASON_STATES } from '@/connectors/source-error'

const sample = {
  scope: 'user@fixture.test',
  operation: 'calendar.events.list',
  status: 403,
  reasons: [],
}

describe('listing failure diagnostics', () => {
  it.each(CONNECTOR_SOURCE_REASON_STATES)(
    'preserves %s reason evidence through durable checkpoint serialization',
    (reasonState) => {
      const fingerprint = 'a'.repeat(64)
      const checkpoint = {
        ...beginListingCheckpoint({
          fingerprint,
          generationId: 'generation',
          startedAt: new Date('2026-09-17T00:00:00Z'),
        }),
        listingFailures: { count: 1, samples: [{ ...sample, reasonState }] },
      }
      expect(
        readListingCheckpoint(structuredClone(checkpoint), fingerprint)?.listingFailures
      ).toEqual(checkpoint.listingFailures)
    }
  )

  it('accepts existing samples without reason state and rejects arbitrary new state strings', () => {
    expect(listingFailuresSchema.parse({ count: 1, samples: [sample] })).toEqual({
      count: 1,
      samples: [sample],
    })
    expect(
      listingFailuresSchema.safeParse({
        count: 1,
        samples: [{ ...sample, reasonState: 'provider-private-description' }],
      }).success
    ).toBe(false)
  })

  it('retains the enum without persisting attached provider messages or response bodies', () => {
    const result = listingFailuresSchema.parse({
      count: 1,
      samples: [{ ...sample, reasonState: 'filtered', message: 'private', body: 'private' }],
    })
    expect(result.samples[0]).toEqual({ ...sample, reasonState: 'filtered' })
  })
})
