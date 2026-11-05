import 'server-only'
import type { SessionPrincipal } from '@sim/auth/principal'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'
import { permissionGroupKeys } from '@/hooks/queries/utils/permission-group-keys'

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
  const { readPermissionGroupEditorCatalog } = await import(
    '@/lib/permission-groups/application/editor-catalog'
  )
  await queryClient.prefetchQuery({
    queryKey: permissionGroupKeys.editorCatalog(organizationId),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () =>
      readPermissionGroupEditorCatalog.execute({ principal, input: { organizationId } }),
  })
  return dehydrate(queryClient)
}
