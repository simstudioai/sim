import type { ResourceScope } from '@/lib/core/resource-scope'

/** Retains the original workspace API while accepting explicit organization ownership. */
export function credentialGroupScope(scope: string | ResourceScope): ResourceScope {
  return typeof scope === 'string' ? { kind: 'workspace', workspaceId: scope } : scope
}
