import { needsRenderedArtifact } from '@/lib/uploads/utils/file'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-content-type'

/**
 * Whether serving a file hands back its stored object byte-for-byte, rather than a representation
 * produced from it: a Sim page renders and a generated document compiles. The file-serve route
 * streams exactly these, and the client hands exactly these to the browser's download manager, so
 * one answer keeps the two from disagreeing about which files a probe may vouch for.
 *
 * A recorded type tells a finished upload from a generation source; without one, every document
 * name may be a source.
 */
export function servesStoredBytes(
  contentType: string | null | undefined,
  fileName: string
): boolean {
  if (contentType === SIM_PAGE_CONTENT_TYPE || fileName.toLowerCase().endsWith('.html')) {
    return false
  }
  return !needsRenderedArtifact(contentType, fileName)
}
