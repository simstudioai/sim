import { ORGANIZATIONS_PATH } from '@/lib/navigation/paths'
import { useOrganizationList } from '@/hooks/queries/organization'

/** Account navigation follows the viewer's memberships, independently of the workspace host. */
export function useOrganizationNavigationHref(): string | null {
  const { data: organizations } = useOrganizationList()
  return organizations?.length ? ORGANIZATIONS_PATH : null
}
