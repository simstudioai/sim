import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { ReadWorkspaceFileTextResult } from '@/lib/workspace-files/application/read-workspace-file-text'

/** The CLI and HTTP surface expose text metadata, never the private provenance sidecar. */
export function presentWorkspaceFileText({
  file,
  text,
  truncated,
  degraded,
  degradedReason,
  byteCount,
}: ReadWorkspaceFileTextResult) {
  return {
    data: {
      fileId: file.id,
      name: file.name,
      path: workspaceFileVfsPath(file),
      type: file.type,
      text,
      truncated,
      degraded,
      degradedReason,
      charCount: text.length,
      byteCount,
    },
  }
}
