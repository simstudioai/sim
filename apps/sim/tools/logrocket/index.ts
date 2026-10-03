import { createReleaseTool } from '@/tools/logrocket/create_release'
import { getAuditLogsTool } from '@/tools/logrocket/get_audit_logs'
import { getHighlightsTool } from '@/tools/logrocket/get_highlights'
import { identifyUserTool } from '@/tools/logrocket/identify_user'
import { listExportedSessionsTool } from '@/tools/logrocket/list_exported_sessions'
import { requestHighlightsTool } from '@/tools/logrocket/request_highlights'

export const logrocketRequestHighlightsTool = requestHighlightsTool
export const logrocketGetHighlightsTool = getHighlightsTool
export const logrocketListExportedSessionsTool = listExportedSessionsTool
export const logrocketGetAuditLogsTool = getAuditLogsTool
export const logrocketIdentifyUserTool = identifyUserTool
export const logrocketCreateReleaseTool = createReleaseTool
