import { createHash } from 'node:crypto'
import {
  SOURCE_REQUEST_BODY_CEILING_BYTES,
  STAGE_PART_FRAMING_BYTES,
  stageBatches,
  WORKSPACE_SOURCE_LIMITS,
  WORKSPACE_SOURCE_STAGE_MAX_BYTES,
} from '@sim/workspace-code/limits'
import { describe, expect, it } from 'vitest'

interface Sized {
  size: number
  fill: number
}

/** The bytes of each staging request `blobs` split into, serialized as the CLI sends them. */
async function requestBodies(blobs: Sized[]): Promise<number[]> {
  const sizes: number[] = []
  for (const batch of stageBatches(blobs)) {
    const form = new FormData()
    for (const blob of batch) {
      const bytes = Buffer.alloc(blob.size, blob.fill)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      form.append(sha256, new Blob([new Uint8Array(bytes)]), sha256)
    }
    sizes.push((await new Response(form).arrayBuffer()).byteLength)
  }
  return sizes
}

const of = (count: number, size: number): Sized[] =>
  Array.from({ length: count }, (_, index) => ({ size, fill: index % 256 }))

describe('staging requests', () => {
  it.each([
    ['two 6 MB files', of(2, 6_000_000)],
    ['two files just under the per-request cap together', of(2, 4_900_000)],
    ['one file of the largest size a directory holds', of(1, WORKSPACE_SOURCE_LIMITS.maxBlobBytes)],
    ['a large file between small ones', [...of(3, 1_000), ...of(1, 9_999_999), ...of(3, 1_000)]],
    [
      'as many tiny files as one request carries',
      of(WORKSPACE_SOURCE_LIMITS.maxBlobsPerRequest, 1),
    ],
  ])(
    '%s: every request body fits the route cap, which fits the proxy ceiling',
    async (_, blobs) => {
      const bodies = await requestBodies(blobs)

      for (const bytes of bodies)
        expect(bytes).toBeLessThanOrEqual(WORKSPACE_SOURCE_STAGE_MAX_BYTES)
      expect(WORKSPACE_SOURCE_STAGE_MAX_BYTES).toBeLessThan(SOURCE_REQUEST_BODY_CEILING_BYTES)
    }
  )

  it('sends a file too large to share a request in one of its own, never dropping it', () => {
    const blobs = [
      ...of(1, 3_000_000),
      ...of(1, WORKSPACE_SOURCE_LIMITS.maxBlobBytes),
      ...of(1, 10),
    ]

    const batches = stageBatches(blobs)

    expect(batches.map((batch) => batch.map((blob) => blob.size))).toEqual([
      [3_000_000],
      [WORKSPACE_SOURCE_LIMITS.maxBlobBytes],
      [10],
    ])
  })

  it('budgets the framing of each part, so a full request of tiny files is split by count', () => {
    const count = WORKSPACE_SOURCE_LIMITS.maxBlobsPerRequest + 1
    const perPart = Math.floor(WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest / 10)

    expect(stageBatches(of(count, 0)).map((batch) => batch.length)).toEqual([count - 1, 1])
    expect(
      stageBatches(of(10, perPart - STAGE_PART_FRAMING_BYTES + 1)).map((batch) => batch.length)
    ).toEqual([9, 1])
  })
})
