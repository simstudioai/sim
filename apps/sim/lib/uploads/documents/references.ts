interface DocumentFileReference {
  fileId: string
  start: number
  end: number
}

const INPUT_PATH_RE = /\/home\/user\/inputs\/([A-Za-z0-9_-]+)/g
const FILE_HELPER_RE =
  /\b(?:getFileBase64|addImage|drawImage|input_path)\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?['"]([A-Za-z0-9_-]+)['"]/g

/** Shares the compiler's static image/template grammar with source copies; bare text is never a file reference. */
export function* iterateDocumentFileReferences(source: string): Generator<DocumentFileReference> {
  for (const pattern of [INPUT_PATH_RE, FILE_HELPER_RE]) {
    for (const match of source.matchAll(pattern)) {
      const fileId = match[1]
      if (!fileId) continue
      const start = match.index + match[0].lastIndexOf(fileId)
      yield { fileId, start, end: start + fileId.length }
    }
  }
}
