/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ContentRefusalReason, ContentSourceKind } from '@/lib/core/application'
import { describeWithheldContent } from '@/lib/mothership/content-delivery/telemetry'

function withheld(
  entries: [ContentSourceKind, [ContentRefusalReason, number][]][]
): Map<ContentSourceKind, Map<ContentRefusalReason, number>> {
  return new Map(entries.map(([kind, reasons]) => [kind, new Map(reasons)]))
}

describe('describeWithheldContent', () => {
  it('says nothing when nothing was withheld', () => {
    expect(describeWithheldContent(new Map())).toBeUndefined()
  })

  it('tells Chat what each refusal means for its next read, naming no item', () => {
    const note = describeWithheldContent(
      withheld([
        ['knowledge-document', [['unknown', 3]]],
        ['workspace-file', [['opaque', 1]]],
        [
          'table-row',
          [
            ['registry', 2],
            ['import', 1],
          ],
        ],
      ])
    )
    expect(note?.split('\n')).toEqual([
      'Note: 3 knowledge documents were withheld from this result: their secret provenance is unknown, so reading them again will not return them. They exist; do not treat them as missing.',
      'Note: 1 file was withheld from this result: it contains recorded secrets and cannot be shown as raw bytes or a preview. Read it as text for a redacted copy.',
      'Note: 2 table rows were withheld from this result: their secret provenance could not be verified right now. They may be readable on a later request.',
      'Note: 1 table row was withheld from this result: its secret provenance could not be verified right now. It may be readable on a later request.',
    ])
  })
})
