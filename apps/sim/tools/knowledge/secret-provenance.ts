import { isPlainRecord } from '@sim/utils/object'
import type { PrivateSecretProvenanceSelection } from '@/lib/execution/model-input-provenance'
import {
  knowledgeDocumentContentSelectionKey,
  knowledgeDocumentFilenameSelectionKey,
  knowledgeDocumentTagValueSelectionKey,
} from '@/lib/knowledge/secret-provenance-selection'
import { parseDocumentTags } from '@/tools/shared/tags'

function isPersistedTagCandidate(entry: unknown): entry is Record<string, unknown> {
  if (!isPlainRecord(entry)) return false
  const tagName = entry.tagName
  if (!tagName || (typeof tagName === 'string' && tagName.trim() === '')) return false
  return entry.value !== undefined && entry.value !== null && entry.value !== ''
}

function documentTagValueInputPaths(
  value: unknown
): PrivateSecretProvenanceSelection['inputPaths'][] {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((entry) => (isPersistedTagCandidate(entry) ? [[['documentTags']]] : []))
    } catch {
      return []
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      isPersistedTagCandidate(entry) ? [[['documentTags', String(index), 'value']]] : []
    )
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([tagName, tagValue]) =>
      tagName.trim() !== '' && tagValue !== undefined && tagValue !== null && tagValue !== ''
        ? [[['documentTags', tagName]]]
        : []
    )
  }

  return []
}

/** Selects durable fields the document sidecar can represent; tag names remain raw and untracked. */
export function selectKnowledgeDocumentWriteSecretProvenance(params: {
  name?: unknown
  content?: unknown
  documentTags?: unknown
}): PrivateSecretProvenanceSelection[] {
  const tags = parseDocumentTags(params.documentTags)
  const tagPaths = documentTagValueInputPaths(params.documentTags)
  const persistedTagPaths = tagPaths.filter((_, index) => {
    const tag = tags[index]
    return tag !== undefined && tag.tagName.trim() !== '' && tag.value !== ''
  })

  return [
    { key: knowledgeDocumentFilenameSelectionKey(0), inputPaths: [['name']] },
    { key: knowledgeDocumentContentSelectionKey(0), inputPaths: [['content']] },
    ...persistedTagPaths.map((inputPaths, tagIndex) => ({
      key: knowledgeDocumentTagValueSelectionKey(0, tagIndex),
      inputPaths,
    })),
  ]
}
