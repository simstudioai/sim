import type { PrivateSecretProvenanceSelection } from '@/lib/execution/model-input-provenance'
import {
  knowledgeDocumentContentSelectionKey,
  knowledgeDocumentFilenameSelectionKey,
  knowledgeDocumentTagNameSelectionKey,
  knowledgeDocumentTagValueSelectionKey,
  parseKnowledgeDocumentTagProvenanceTargets,
} from '@/lib/knowledge/secret-provenance-selection'
import { inferDocumentFileInfo } from '@/tools/knowledge/types'
import { formatDocumentTagsForAPI, parseDocumentTags } from '@/tools/shared/tags'

/** Selects each causally independent persisted document field before request serialization. */
export function selectKnowledgeDocumentWriteSecretProvenance(params: {
  name?: unknown
  content?: unknown
  documentTags?: unknown
}): PrivateSecretProvenanceSelection[] {
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  const content = typeof params.content === 'string' ? params.content.trim() : params.content
  const filename = inferDocumentFileInfo(name).filename
  const tags = parseKnowledgeDocumentTagProvenanceTargets(
    formatDocumentTagsForAPI(parseDocumentTags(params.documentTags)).documentTagsData
  )

  return [
    { key: knowledgeDocumentFilenameSelectionKey(0), value: filename },
    { key: knowledgeDocumentContentSelectionKey(0), value: content },
    ...tags.flatMap((tag, tagIndex) => [
      { key: knowledgeDocumentTagNameSelectionKey(0, tagIndex), value: tag.tagName },
      { key: knowledgeDocumentTagValueSelectionKey(0, tagIndex), value: tag.value },
    ]),
  ]
}
