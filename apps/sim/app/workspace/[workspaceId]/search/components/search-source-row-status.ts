import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'

interface SearchSourceStatusInput {
  source: SearchSourceSummary
  scopeKind: ResourceScope['kind']
  supported: boolean
  usable: boolean
  connectable: boolean
  waiting: boolean
}

/** Source and integration rows share one member-facing status priority. */
export function getSearchSourceStatus({
  source,
  scopeKind,
  supported,
  usable,
  connectable,
  waiting,
}: SearchSourceStatusInput): string {
  const membership = source.viewerMembership
  const count = `${source.viewerDocumentCount} searchable document${source.viewerDocumentCount === 1 ? '' : 's'}`
  let status: string
  if (!supported) status = 'Available in its knowledge base'
  else if (source.approved === false) status = 'Deactivated by an organization admin'
  else if (!usable) status = `Not available in this ${scopeKind}`
  else if (!source.enabled) status = 'Syncing is paused'
  else if (!source.viewerEmailVerified || membership === 'unverified_email')
    status = 'Verify your email to search this source'
  else if (membership === 'revoked') status = 'Your access was removed by an admin'
  else if (source.connectionRequired && membership === null) status = 'Needs admin attention'
  else if (connectable)
    status = waiting
      ? 'Finish connecting in the other tab'
      : membership === 'needs_reauth'
        ? 'Your account needs to be reconnected'
        : 'Connect your account to search this source'
  else if (source.hasSyncError || source.viewerFailedDocumentCount > 0)
    status = 'Sync needs attention'
  else if (source.isSyncing) status = 'Indexing'
  else if (source.viewerDocumentCount > 0) status = count
  else status = source.lastSyncAt ? 'No searchable documents yet' : 'Waiting for the first sync'
  return status
}
