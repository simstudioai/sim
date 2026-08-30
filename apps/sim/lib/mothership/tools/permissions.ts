import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'

/**
 * Whether a copilot tool call may write. Fails closed: `userPermission` is
 * optional on the execution context, and absent must deny. Shared by the
 * server-tool router and the handler-map tools.
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
