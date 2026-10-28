import type { ContractBody } from '@/lib/api/contracts/types'
import type { v2CreateProjectFileContract } from '@/lib/api/contracts/v2/project-files'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file'

/** One mapping from the public create body to the use case, shared by the v2 route and the CLI. */
export function toCreateProjectFileInput(
  projectId: string,
  body: ContractBody<typeof v2CreateProjectFileContract>
) {
  return {
    projectId,
    name: body.name,
    contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
    content: body.content,
    encoding: body.encoding,
    folderPath: body.folderPath ?? '/',
    exactName: true,
  }
}
