import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { requireSourceMirroredAccessAvailable } from '@/lib/knowledge/access/availability'
import { connectorServiceAccountSubject } from '@/lib/knowledge/connectors/access-token'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * Refuses admin mode on a connector that cannot mirror the source's
 * permissions, or that has not been told whose eyes to crawl through.
 *
 * Both are refusals rather than warnings because the alternative is a corpus
 * indexed with no ACL at all: every document readable by nobody, which looks
 * exactly like a broken sync. Failing at the moment the mode is chosen — or
 * the config edited — says what is missing while the person doing it can
 * still supply it. A leaf module so creation, the mode switch and the config
 * update all refuse exactly the same things.
 */
export async function assertConnectorMirrorsSourceAcls(
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth' | 'mirrorsSourceAcls'>,
  sourceConfig: Record<string, unknown>,
  scope: string | ResourceScope
): Promise<void> {
  await requireSourceMirroredAccessAvailable(
    typeof scope === 'string' ? { workspaceId: scope } : resourceScopeFields(scope)
  )
  if (!connectorMeta.mirrorsSourceAcls) {
    throw new OrchestrationError(
      'validation',
      `${connectorMeta.name} cannot mirror source permissions, so it has no administrator mode`
    )
  }
  /**
   * Only a connector that impersonates needs a subject. A Drive service account
   * sees nothing until it acts as an administrator; an Atlassian one holds an
   * API token that already speaks for the site.
   */
  const { auth } = connectorMeta
  const impersonates = auth.mode === 'oauth' && Boolean(auth.serviceAccountSubjectFieldId)
  if (impersonates && !connectorServiceAccountSubject(auth, sourceConfig)) {
    throw new OrchestrationError(
      'validation',
      `${connectorMeta.name} needs the administrator to crawl as before it can mirror permissions`
    )
  }
}
