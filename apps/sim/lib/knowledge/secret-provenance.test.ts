/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import {
  createKnowledgeDocumentSourceValue,
  readBoundKnowledgeDocumentSecretProvenance,
} from '@/lib/knowledge/secret-provenance'

describe('knowledge durable secret provenance', () => {
  it('uses the same explicit source shape for joined rows and persisted writes', () => {
    const source = createKnowledgeDocumentSourceValue({
      filename: 'file.txt',
      fileUrl: 'https://example.com/file.txt',
      sourceUrl: null,
      tag1: 'one',
      tag2: null,
      tag3: null,
      tag4: null,
      tag5: null,
      tag6: null,
      tag7: null,
    })
    const joinedRow = {
      ...source,
      secretProvenanceVersion: 1,
      provenanceSourceHash: hashDurableSecretProvenanceValue(source),
      status: 'exact',
      entries: [],
      unrelatedJoinedField: 'must-not-enter-the-hash',
    }

    const canonicalSource = createKnowledgeDocumentSourceValue(joinedRow)

    expect(canonicalSource).toEqual(source)
    expect(
      readBoundKnowledgeDocumentSecretProvenance({
        ...joinedRow,
        source: canonicalSource,
      })
    ).toEqual({ status: 'exact', entries: [] })

    expect(
      readBoundKnowledgeDocumentSecretProvenance({
        ...joinedRow,
        secretProvenanceVersion: null,
        provenanceSourceHash: 'stale',
        entries: [{ name: 'SECRET', encryptedValue: 'encrypted' }],
        source: { ...canonicalSource, filename: 'changed-by-old-app.txt' },
      })
    ).toEqual({ status: 'exact', entries: [] })
  })
})
