import type { ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  isOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

export class ServerToolModelInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerToolModelInputError'
  }
}

/** Projects rewritable server-tool input immediately before it crosses a model boundary. */
export function projectServerToolModelInput<T>(value: T, context?: ServerToolContext): T {
  const projection = projectResolvedSecretModelContent(value, context?.resolvedSecretTraceRegistry)
  if (!projection.safe) {
    throw new ServerToolModelInputError('Model input could not be projected safely')
  }
  return projection.value as T
}

/**
 * Verifies the exact persisted provenance bound to an opaque workspace file before its bytes leave
 * Sim. Opaque media cannot be rewritten safely, so tracked or unavailable provenance is rejected.
 */
export async function assertOpaqueWorkspaceFileModelSafe(args: {
  workspaceId: string
  file: WorkspaceFileRecord
}): Promise<void> {
  const safe = await isOpaqueWorkspaceFileEgressSafe(args.workspaceId, {
    fileId: args.file.id,
    key: args.file.key,
    context: args.file.storageContext ?? 'workspace',
  })
  if (!safe) {
    throw new ServerToolModelInputError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
  }
}
