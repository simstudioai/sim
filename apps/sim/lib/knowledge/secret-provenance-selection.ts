export function knowledgeDocumentFilenameSelectionKey(documentIndex: number): string {
  return `document-filename:${documentIndex}`
}

export function knowledgeDocumentContentSelectionKey(documentIndex: number): string {
  return `document-content:${documentIndex}`
}

export function knowledgeDocumentTagNameSelectionKey(
  documentIndex: number,
  tagIndex: number
): string {
  return `document-tag-name:${documentIndex}:${tagIndex}`
}

export function knowledgeDocumentTagValueSelectionKey(
  documentIndex: number,
  tagIndex: number
): string {
  return `document-tag-value:${documentIndex}:${tagIndex}`
}
