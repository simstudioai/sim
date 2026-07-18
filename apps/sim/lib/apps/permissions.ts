import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export type AppPermissionAction = 'edit' | 'preview' | 'bind' | 'publish' | 'rollback' | 'revoke'

/**
 * Project edit + preview execute = workspace write.
 * Bind / publish / rollback / revoke = admin.
 */
export async function assertAppPermission(
  userId: string,
  workspaceId: string,
  action: AppPermissionAction
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    return { ok: false, status: 404, message: 'Workspace not found' }
  }

  const needsAdmin =
    action === 'bind' || action === 'publish' || action === 'rollback' || action === 'revoke'
  if (needsAdmin) {
    if (permission !== 'admin') {
      return { ok: false, status: 403, message: 'Admin permission required' }
    }
    return { ok: true }
  }

  if (permission !== 'write' && permission !== 'admin') {
    return { ok: false, status: 403, message: 'Write permission required' }
  }
  return { ok: true }
}
