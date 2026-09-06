import type { ChatContextItem } from '@/lib/mothership/generated/protocol'
import { encodeVfsSegment } from '@/lib/mothership/vfs/path-utils'
import { buildArchiveExtractGuidance, isArchiveFileName } from '@/lib/uploads/utils/file-utils'

/** The same chat upload path works for CLI reads, code mounts and image references. */
export function buildUploadedFileContext(
  displayName: string,
  mediaType: string,
  size: number
): ChatContextItem {
  let encodedUploadName = displayName
  try {
    encodedUploadName = encodeVfsSegment(displayName)
  } catch {
    encodedUploadName = displayName
  }
  if (isArchiveFileName(displayName)) {
    return {
      type: 'uploaded_file',
      content: [
        `Archive "${displayName}" (${mediaType}, ${size} bytes) uploaded.`,
        buildArchiveExtractGuidance(displayName),
      ].join('\n'),
    }
  }
  const lines = [
    `File "${displayName}" (${mediaType}, ${size} bytes) uploaded to this chat as "uploads/${encodedUploadName}" (a chat upload: readable here, not listed under workspace files/).`,
    `Read it with: sim --output json files read "uploads/${encodedUploadName}"`,
    `Pass the same path "uploads/${encodedUploadName}" as inputs.files[].path to mount it in run_code or use it as a reference image in generate_image.`,
  ]
  if (displayName.endsWith('.json')) {
    lines.push(
      "If it is a workflow export: read it with files read, then import the JSON with: sim --output json workflows import --workflow '<the JSON>'"
    )
  }
  return { type: 'uploaded_file', content: lines.join('\n') }
}
