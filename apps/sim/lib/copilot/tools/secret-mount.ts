import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'
import { extractCodeSecretNames } from '@/executor/utils/code-secret-references'

export { extractCodeSecretNames } from '@/executor/utils/code-secret-references'

export const SECRET_MOUNT_CAPABILITY = 'secret_mount' as const

export function toolHasSecretMountCapability(toolName: string): boolean {
  const capabilities = TOOL_CATALOG[toolName]?.capabilities
  return Array.isArray(capabilities) && capabilities.includes(SECRET_MOUNT_CAPABILITY)
}

/** Returns the explicit secret names requested by a catalog-declared secret-mounting tool call. */
export function getToolSecretMountNames(
  toolName: string,
  params: Record<string, unknown> | undefined
): string[] {
  if (!toolHasSecretMountCapability(toolName) || !params) return []
  return extractCodeSecretNames(params.code, params.language)
}
