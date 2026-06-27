import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'

/**
 * Guards a post-tool output-redirection sink against read-only principals.
 *
 * `function_execute`, `user_table`, and `read` are read-allowed for execution
 * (they don't mutate the workspace themselves), so the router's `WRITE_ACTIONS`
 * gate in `tools/server/router.ts` lets read-only collaborators run them. But
 * their output-redirection declarations (`outputs.files`, `outputTable`)
 * durably persist to the workspace — creating/overwriting files and table rows.
 * Those writes must satisfy the same write gate as the dedicated mutation tools.
 *
 * Returns a denial `ToolCallResult` when the caller lacks write access (so the
 * agent surfaces the same `Permission denied` outcome it gets from `create_file`
 * / `user_table` writes), or `null` when the write may proceed.
 */
export function denyOutputWriteWithoutWritePermission(
  context: ExecutionContext
): ToolCallResult | null {
  if (permissionSatisfies(context.userPermission as PermissionType | undefined, 'write')) {
    return null
  }
  return {
    success: false,
    error: `Permission denied: writing tool output to the workspace requires write access. You have '${context.userPermission ?? 'none'}' permission.`,
  }
}
