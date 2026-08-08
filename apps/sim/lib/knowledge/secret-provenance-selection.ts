export interface KnowledgeDocumentTagProvenanceTarget {
  tagName: string
  value: unknown
}

/**
 * Parses only tag entries that can causally contribute a persisted tag value. Both the tool that
 * builds the request selections and the route that builds the write targets read this one parser,
 * so their counts can never diverge.
 */
export function parseKnowledgeDocumentTagProvenanceTargets(
  documentTagsData: string | undefined
): KnowledgeDocumentTagProvenanceTarget[] {
  if (!documentTagsData) return []
  try {
    const parsed: unknown = JSON.parse(documentTagsData)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const record = candidate as Record<string, unknown>
      const tagName = typeof record.tagName === 'string' ? record.tagName.trim() : ''
      if (!tagName || record.value === undefined || record.value === null || record.value === '') {
        return []
      }
      return [{ tagName, value: record.value }]
    })
  } catch {
    return []
  }
}

export function knowledgeDocumentFilenameSelectionKey(documentIndex: number): string {
  return `document-filename:${documentIndex}`
}

export function knowledgeDocumentContentSelectionKey(documentIndex: number): string {
  return `document-content:${documentIndex}`
}

export function knowledgeDocumentTagValueSelectionKey(
  documentIndex: number,
  tagIndex: number
): string {
  return `document-tag-value:${documentIndex}:${tagIndex}`
}
