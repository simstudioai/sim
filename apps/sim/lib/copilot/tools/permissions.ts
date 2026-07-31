import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'

/**
 * Whether a copilot tool call may perform a write, given the workspace
 * permission resolved for the request.
 *
 * **Fails closed.** `ExecutionContext.userPermission` is optional, so an absent
 * value must deny — the hand-written `perm && perm !== 'write' && perm !==
 * 'admin'` ladders this replaces skipped the check entirely when the field was
 * undefined, letting a write through unguarded. Shared by the server-tool
 * router and the handler-map tools so the two copilot execution paths cannot
 * disagree about what "write access" means.
 */
export function copilotToolCanWrite(userPermission: string | null | undefined): boolean {
  return permissionSatisfies((userPermission ?? null) as PermissionType | null, 'write')
}

/** Renders the denial message shared by both copilot execution paths. */
export function copilotWriteDeniedMessage(
  toolName: string,
  operation: string | undefined,
  userPermission: string | null | undefined
): string {
  const actionLabel = operation ? `'${operation}' on ` : ''
  return `Permission denied: ${actionLabel}${toolName} requires write access. You have '${userPermission || 'none'}' permission.`
}
