/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  knowledgeDocumentContentSelectionKey,
  knowledgeDocumentFilenameSelectionKey,
  knowledgeDocumentTagValueSelectionKey,
  parseKnowledgeDocumentTagProvenanceTargets,
} from '@/lib/knowledge/secret-provenance-selection'
import { selectKnowledgeDocumentWriteSecretProvenance } from '@/tools/knowledge/secret-provenance'
import { formatDocumentTagsForAPI, parseDocumentTags } from '@/tools/shared/tags'

/** Mirrors the selection keys the knowledge write route derives from the serialized request body. */
function serverSelectionKeys(documentTags: unknown): string[] {
  const { documentTagsData } = formatDocumentTagsForAPI(parseDocumentTags(documentTags))
  return [
    knowledgeDocumentFilenameSelectionKey(0),
    knowledgeDocumentContentSelectionKey(0),
    ...parseKnowledgeDocumentTagProvenanceTargets(documentTagsData).map((_tag, tagIndex) =>
      knowledgeDocumentTagValueSelectionKey(0, tagIndex)
    ),
  ]
}

const EMPTY_STRINGIFYING_TAG_VALUES = [
  ['empty array', []],
  ['array of null', [null]],
  ['array of undefined', [undefined]],
  ['object stringifying to empty', { toString: () => '' }],
] as const

describe('selectKnowledgeDocumentWriteSecretProvenance', () => {
  it.each(EMPTY_STRINGIFYING_TAG_VALUES)(
    'agrees with the server target count for a tag value that is a %s',
    (_label, tagValue) => {
      const documentTags = [
        { tagName: 'kept', value: 'value' },
        { tagName: 'dropped', value: tagValue },
      ]
      const selections = selectKnowledgeDocumentWriteSecretProvenance({
        name: 'doc.md',
        content: 'content',
        documentTags,
      })

      expect(selections.map((selection) => selection.key)).toEqual(
        serverSelectionKeys(documentTags)
      )
    }
  )

  it('keeps tags whose serialized value is non-empty', () => {
    const documentTags = { alpha: 'one', beta: 2, gamma: false }
    const selections = selectKnowledgeDocumentWriteSecretProvenance({
      name: 'doc.md',
      content: 'content',
      documentTags,
    })

    expect(selections.map((selection) => selection.key)).toEqual(serverSelectionKeys(documentTags))
    expect(selections).toHaveLength(5)
    expect(selections).toEqual([
      { key: 'document-filename:0', inputPaths: [['name']] },
      { key: 'document-content:0', inputPaths: [['content']] },
      { key: 'document-tag-value:0:0', inputPaths: [['documentTags', 'alpha']] },
      { key: 'document-tag-value:0:1', inputPaths: [['documentTags', 'beta']] },
      { key: 'document-tag-value:0:2', inputPaths: [['documentTags', 'gamma']] },
    ])
  })

  it('selects array tag values without tracking persisted tag names', () => {
    const selections = selectKnowledgeDocumentWriteSecretProvenance({
      name: 'doc.md',
      content: 'content',
      documentTags: [
        { tagName: 'team', value: 'support' },
        { tagName: 'region', value: 'west' },
      ],
    })

    expect(selections).toEqual([
      { key: 'document-filename:0', inputPaths: [['name']] },
      { key: 'document-content:0', inputPaths: [['content']] },
      { key: 'document-tag-value:0:0', inputPaths: [['documentTags', '0', 'value']] },
      { key: 'document-tag-value:0:1', inputPaths: [['documentTags', '1', 'value']] },
    ])
  })

  it('uses the whole resolver leaf for JSON-string tag inputs', () => {
    const documentTags = JSON.stringify([
      { tagName: 'team', value: 'support' },
      { tagName: 'region', value: 'west' },
    ])
    const selections = selectKnowledgeDocumentWriteSecretProvenance({
      name: 'doc.md',
      content: 'content',
      documentTags,
    })

    expect(selections.map((selection) => selection.key)).toEqual(serverSelectionKeys(documentTags))
    expect(
      selections.slice(2).every(({ inputPaths }) => inputPaths[0]?.[0] === 'documentTags')
    ).toBe(true)
  })
})
