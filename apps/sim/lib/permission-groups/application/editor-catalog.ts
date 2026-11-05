import {
  defineAuthorizedPermissionGroupUseCase,
  type PermissionGroupOrganizationInput,
} from '@/lib/permission-groups/application/authorized-permission-group-use-case'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { buildPermissionGroupEditorCatalog } from '@/ee/access-control/lib/editor-catalog.server'

/** The block and provider catalog behind the group editor, unfiltered by the acting admin. */
export const readPermissionGroupEditorCatalog = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.readEditorCatalog,
  execute: ({
    input,
    context,
  }: {
    input: PermissionGroupOrganizationInput
    context: { userId: string }
  }) =>
    buildPermissionGroupEditorCatalog({
      organizationId: input.organizationId,
      userId: context.userId,
    }),
})
