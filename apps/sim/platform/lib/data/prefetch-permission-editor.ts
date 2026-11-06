import 'server-only'
import type { SessionPrincipal } from '@sim/auth/principal'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  PERMISSION_EDITOR_CATALOG_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'

/**
 * The block and provider catalog behind the group editor, for the query the editor reads. Loaded
 * here so the registries stay out of the page's client bundle, and only on this section. A failed
 * read stays out of hydration and the editor offers a retry.
 */
export async function prefetchPermissionEditorCatalog(
  organizationId: string,
  principal: SessionPrincipal
): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: permissionGroupKeys.editorCatalog(organizationId),
    staleTime: PERMISSION_EDITOR_CATALOG_STALE_TIME,
    queryFn: async () => {
      const { readPermissionGroupEditorCatalog } = await import(
        '@/lib/permission-groups/application/editor-catalog'
      )
      return readPermissionGroupEditorCatalog.execute({ principal, input: { organizationId } })
    },
  })
  return dehydrate(queryClient)
}
