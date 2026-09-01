import { createLogger } from '@sim/logger'

const logger = createLogger('WorkspaceFileContentOrchestration')

/** Ceiling on a single content replace, independent of the workspace quota. */
export const MAX_WORKSPACE_FILE_CONTENT_BYTES = 50 * 1024 * 1024

/** JSON-body ceiling with room for a 50 MiB file's base64 expansion and envelope. */
export const MAX_WORKSPACE_FILE_INLINE_BODY_BYTES = 70 * 1024 * 1024
