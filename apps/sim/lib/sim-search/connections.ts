import type { WorkspaceMemberConnector } from '@/lib/api/contracts/knowledge/connectors'

/** The canonical index keeps every configured source, including multiple sites of one provider. */
export function groupSearchConnections(connectors: readonly WorkspaceMemberConnector[]) {
  const connectionByType = new Map<string, WorkspaceMemberConnector[]>()
  const sharedConnectors: WorkspaceMemberConnector[] = []
  for (const connector of connectors) {
    if (connector.knowledgeBaseIsSearchIndex === true) {
      const existing = connectionByType.get(connector.connectorType)
      if (existing) existing.push(connector)
      else connectionByType.set(connector.connectorType, [connector])
    } else {
      sharedConnectors.push(connector)
    }
  }
  return { connectionByType, sharedConnectors }
}
