import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

export const clickupWorkspacesBodySchema = credentialWorkflowBodySchema

export const clickupSpacesBodySchema = credentialWorkflowBodySchema.extend({
  teamId: z.string().min(1, 'Workspace (team) ID is required'),
})

export const clickupFoldersBodySchema = credentialWorkflowBodySchema.extend({
  spaceId: z.string().min(1, 'Space ID is required'),
})

/**
 * ClickUp lists live either inside a folder or directly in a space
 * (folderless). The route dispatches on whichever ID is provided, preferring
 * the folder when both are present.
 */
export const clickupListsBodySchema = credentialWorkflowBodySchema
  .extend({
    folderId: optionalString,
    spaceId: optionalString,
  })
  .superRefine((body, ctx) => {
    if (!body.folderId?.trim() && !body.spaceId?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['folderId'],
        message: 'Either folderId or spaceId is required',
      })
    }
  })

export const clickupWorkspacesSelectorContract = definePostSelector(
  '/api/tools/clickup/workspaces',
  clickupWorkspacesBodySchema,
  z.object({ workspaces: z.array(idNameSchema) })
)

export const clickupSpacesSelectorContract = definePostSelector(
  '/api/tools/clickup/spaces',
  clickupSpacesBodySchema,
  z.object({ spaces: z.array(idNameSchema) })
)

export const clickupFoldersSelectorContract = definePostSelector(
  '/api/tools/clickup/folders',
  clickupFoldersBodySchema,
  z.object({ folders: z.array(idNameSchema) })
)

export const clickupListsSelectorContract = definePostSelector(
  '/api/tools/clickup/lists',
  clickupListsBodySchema,
  z.object({ lists: z.array(idNameSchema) })
)

export type ClickupWorkspacesSelectorResponse = ContractJsonResponse<
  typeof clickupWorkspacesSelectorContract
>
export type ClickupSpacesSelectorResponse = ContractJsonResponse<
  typeof clickupSpacesSelectorContract
>
export type ClickupFoldersSelectorResponse = ContractJsonResponse<
  typeof clickupFoldersSelectorContract
>
export type ClickupListsSelectorResponse = ContractJsonResponse<typeof clickupListsSelectorContract>
