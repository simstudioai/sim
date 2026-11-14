import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'

/**
 * Whether a copilot tool call may write. Fails closed: `userPermission` is
 * optional on the execution context, and absent must deny.
 */
export function copilotToolCanWrite(userPermission: string | null | undefined): boolean {
  return permissionSatisfies((userPermission ?? null) as PermissionType | null, 'write')
}

/** Renders the denial for a copilot tool call that would write without write access. */
export function copilotWriteDeniedMessage(
  toolName: string,
  operation: string | null | undefined,
  userPermission: string | null | undefined
): string {
  const actionLabel = operation ? `'${operation}' on ` : ''
  return `Permission denied: ${actionLabel}${toolName} requires write access. You have '${userPermission || 'none'}' permission.`
}
