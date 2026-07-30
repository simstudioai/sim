import { OrgResources } from '@/app/workspace/[workspaceId]/org-resources/org-resources'

/**
 * The org API catalog route. The catalog is viewer-scoped (it lists only resources the
 * caller may read), so data is fetched client-side against the org resolved from the
 * workspace host context - no server prefetch needed.
 */
export default function OrgResourcesPage() {
  return <OrgResources />
}
