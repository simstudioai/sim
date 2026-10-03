import { getErrorMessage } from '@sim/utils/errors'
import type {
  AnyApiRouteContract,
  ApiSchema,
  ContractBody,
  ContractQuery,
} from '@/lib/api/contracts'
import {
  confluenceBlogPostOperationContract,
  confluenceCreateCommentContract,
  confluenceCreatePageContract,
  confluenceCreatePagePropertyContract,
  confluenceCreateSpaceContract,
  confluenceDeleteAttachmentContract,
  confluenceDeleteBlogPostContract,
  confluenceDeleteCommentContract,
  confluenceDeleteLabelContract,
  confluenceDeletePageBodySchema,
  confluenceDeletePagePropertyContract,
  confluenceDeleteSpaceContract,
  confluenceGetSpaceContract,
  confluenceLabelMutationContract,
  confluenceListAttachmentsContract,
  confluenceListBlogPostsContract,
  confluenceListCommentsContract,
  confluenceListLabelsContract,
  confluenceListPagePropertiesContract,
  confluenceListSpacesContract,
  confluencePageAncestorsContract,
  confluencePageChildrenContract,
  confluencePageContract,
  confluencePageDescendantsContract,
  confluencePagesByLabelContract,
  confluencePageVersionsContract,
  confluenceSearchContract,
  confluenceSearchInSpaceContract,
  confluenceSpaceBlogPostsContract,
  confluenceSpaceLabelsContract,
  confluenceSpacePagesContract,
  confluenceSpacePermissionsContract,
  confluenceSpacePropertiesContract,
  confluenceTasksContract,
  confluenceUpdateBlogPostContract,
  confluenceUpdateCommentContract,
  confluenceUpdatePageBodySchema,
  confluenceUpdateSpaceContract,
  confluenceUploadAttachmentContract,
  confluenceUserContract,
} from '@/lib/api/contracts/tools/confluence'
import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import {
  type ConfluenceOperationContext,
  executeConfluenceAddLabel,
  executeConfluenceCreateBlogPost,
  executeConfluenceCreateComment,
  executeConfluenceCreatePage,
  executeConfluenceCreatePageProperty,
  executeConfluenceCreateSpace,
  executeConfluenceDeleteAttachment,
  executeConfluenceDeleteBlogPost,
  executeConfluenceDeleteComment,
  executeConfluenceDeleteLabel,
  executeConfluenceDeletePage,
  executeConfluenceDeletePageProperty,
  executeConfluenceDeleteSpace,
  executeConfluenceGetBlogPost,
  executeConfluenceGetPageAncestors,
  executeConfluenceGetPageChildren,
  executeConfluenceGetPageDescendants,
  executeConfluenceGetPagesByLabel,
  executeConfluenceGetSpace,
  executeConfluenceGetUser,
  executeConfluenceListAttachments,
  executeConfluenceListBlogPosts,
  executeConfluenceListBlogPostsInSpace,
  executeConfluenceListComments,
  executeConfluenceListLabels,
  executeConfluenceListPageProperties,
  executeConfluenceListPagesInSpace,
  executeConfluenceListSpaceLabels,
  executeConfluenceListSpacePermissions,
  executeConfluenceListSpaces,
  executeConfluencePageVersions,
  executeConfluenceRetrievePage,
  executeConfluenceSearch,
  executeConfluenceSearchInSpace,
  executeConfluenceSpaceProperties,
  executeConfluenceTasks,
  executeConfluenceUpdateBlogPost,
  executeConfluenceUpdateComment,
  executeConfluenceUpdatePage,
  executeConfluenceUpdateSpace,
  executeConfluenceUploadAttachment,
} from '@/lib/internal/confluence/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

type ContractInput<C extends AnyApiRouteContract> = NonNullable<ContractBody<C> | ContractQuery<C>>

function parsePreparedInput<T>(
  schema: ApiSchema,
  request: InternalToolOperationCall
): { success: true; data: T } | { success: false; response: Response } {
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return {
      success: false,
      response: Response.json(
        { error: 'Invalid request data', details: parsed.error.issues },
        { status: 400 }
      ),
    }
  }
  return { success: true, data: parsed.data as T }
}

/**
 * Operations whose HTTP route was retired hold a bare request schema rather than
 * a contract, so they cannot declare a `method` and `path` nothing serves. The
 * contract form below feeds this the schema it would have parsed anyway.
 */
async function executeSchemaOperation<T>(
  schema: ApiSchema,
  request: InternalToolOperationCall,
  execute: (input: T, context: ConfluenceOperationContext) => Promise<unknown>
): Promise<Response> {
  request.signal?.throwIfAborted()
  const parsed = parsePreparedInput<T>(schema, request)
  if (!parsed.success) return parsed.response
  try {
    const result = await execute(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      error instanceof ConfluenceOperationError && error.body
        ? error.body
        : { error: getErrorMessage(error, 'Internal server error') },
      { status: error instanceof ConfluenceOperationError ? error.status : 500 }
    )
  }
}

function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  request: InternalToolOperationCall,
  execute: (input: ContractInput<C>, context: ConfluenceOperationContext) => Promise<unknown>
): Promise<Response> {
  const schema = contract.query ?? contract.body
  if (!schema) throw new Error(`Confluence contract ${contract.path} has no request input`)
  return executeSchemaOperation<ContractInput<C>>(schema, request, execute)
}

export const executeConfluenceTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'confluence_add_label':
      return executeOperation(confluenceLabelMutationContract, request, executeConfluenceAddLabel)
    case 'confluence_create_blogpost':
      return executeOperation(
        confluenceBlogPostOperationContract,
        request,
        executeConfluenceCreateBlogPost
      )
    case 'confluence_create_comment':
      return executeOperation(
        confluenceCreateCommentContract,
        request,
        executeConfluenceCreateComment
      )
    case 'confluence_create_page':
      return executeOperation(confluenceCreatePageContract, request, executeConfluenceCreatePage)
    case 'confluence_create_page_property':
      return executeOperation(
        confluenceCreatePagePropertyContract,
        request,
        executeConfluenceCreatePageProperty
      )
    case 'confluence_create_space':
      return executeOperation(confluenceCreateSpaceContract, request, executeConfluenceCreateSpace)
    case 'confluence_create_space_property':
      return executeOperation(
        confluenceSpacePropertiesContract,
        request,
        executeConfluenceSpaceProperties
      )
    case 'confluence_delete_attachment':
      return executeOperation(
        confluenceDeleteAttachmentContract,
        request,
        executeConfluenceDeleteAttachment
      )
    case 'confluence_delete_blogpost':
      return executeOperation(
        confluenceDeleteBlogPostContract,
        request,
        executeConfluenceDeleteBlogPost
      )
    case 'confluence_delete_comment':
      return executeOperation(
        confluenceDeleteCommentContract,
        request,
        executeConfluenceDeleteComment
      )
    case 'confluence_delete_label':
      return executeOperation(confluenceDeleteLabelContract, request, executeConfluenceDeleteLabel)
    case 'confluence_delete_page':
      return executeSchemaOperation(
        confluenceDeletePageBodySchema,
        request,
        executeConfluenceDeletePage
      )
    case 'confluence_delete_page_property':
      return executeOperation(
        confluenceDeletePagePropertyContract,
        request,
        executeConfluenceDeletePageProperty
      )
    case 'confluence_delete_space':
      return executeOperation(confluenceDeleteSpaceContract, request, executeConfluenceDeleteSpace)
    case 'confluence_delete_space_property':
      return executeOperation(
        confluenceSpacePropertiesContract,
        request,
        executeConfluenceSpaceProperties
      )
    case 'confluence_get_blogpost':
      return executeOperation(
        confluenceBlogPostOperationContract,
        request,
        executeConfluenceGetBlogPost
      )
    case 'confluence_get_page_ancestors':
      return executeOperation(
        confluencePageAncestorsContract,
        request,
        executeConfluenceGetPageAncestors
      )
    case 'confluence_get_page_children':
      return executeOperation(
        confluencePageChildrenContract,
        request,
        executeConfluenceGetPageChildren
      )
    case 'confluence_get_page_descendants':
      return executeOperation(
        confluencePageDescendantsContract,
        request,
        executeConfluenceGetPageDescendants
      )
    case 'confluence_get_page_version':
    case 'confluence_list_page_versions':
      return executeOperation(
        confluencePageVersionsContract,
        request,
        executeConfluencePageVersions
      )
    case 'confluence_get_pages_by_label':
      return executeOperation(
        confluencePagesByLabelContract,
        request,
        executeConfluenceGetPagesByLabel
      )
    case 'confluence_get_space':
      return executeOperation(confluenceGetSpaceContract, request, executeConfluenceGetSpace)
    case 'confluence_get_task':
    case 'confluence_list_tasks':
    case 'confluence_update_task':
      return executeOperation(confluenceTasksContract, request, executeConfluenceTasks)
    case 'confluence_get_user':
      return executeOperation(confluenceUserContract, request, executeConfluenceGetUser)
    case 'confluence_list_attachments':
      return executeOperation(
        confluenceListAttachmentsContract,
        request,
        executeConfluenceListAttachments
      )
    case 'confluence_list_blogposts':
      return executeOperation(
        confluenceListBlogPostsContract,
        request,
        executeConfluenceListBlogPosts
      )
    case 'confluence_list_blogposts_in_space':
      return executeOperation(
        confluenceSpaceBlogPostsContract,
        request,
        executeConfluenceListBlogPostsInSpace
      )
    case 'confluence_list_comments':
      return executeOperation(
        confluenceListCommentsContract,
        request,
        executeConfluenceListComments
      )
    case 'confluence_list_labels':
      return executeOperation(confluenceListLabelsContract, request, executeConfluenceListLabels)
    case 'confluence_list_page_properties':
      return executeOperation(
        confluenceListPagePropertiesContract,
        request,
        executeConfluenceListPageProperties
      )
    case 'confluence_list_pages_in_space':
      return executeOperation(
        confluenceSpacePagesContract,
        request,
        executeConfluenceListPagesInSpace
      )
    case 'confluence_list_space_labels':
      return executeOperation(
        confluenceSpaceLabelsContract,
        request,
        executeConfluenceListSpaceLabels
      )
    case 'confluence_list_space_permissions':
      return executeOperation(
        confluenceSpacePermissionsContract,
        request,
        executeConfluenceListSpacePermissions
      )
    case 'confluence_list_space_properties':
      return executeOperation(
        confluenceSpacePropertiesContract,
        request,
        executeConfluenceSpaceProperties
      )
    case 'confluence_list_spaces':
      return executeOperation(confluenceListSpacesContract, request, executeConfluenceListSpaces)
    case 'confluence_retrieve':
      return executeOperation(confluencePageContract, request, executeConfluenceRetrievePage)
    case 'confluence_search':
      return executeOperation(confluenceSearchContract, request, executeConfluenceSearch)
    case 'confluence_search_in_space':
      return executeOperation(
        confluenceSearchInSpaceContract,
        request,
        executeConfluenceSearchInSpace
      )
    case 'confluence_update':
      return executeSchemaOperation(
        confluenceUpdatePageBodySchema,
        request,
        executeConfluenceUpdatePage
      )
    case 'confluence_update_blogpost':
      return executeOperation(
        confluenceUpdateBlogPostContract,
        request,
        executeConfluenceUpdateBlogPost
      )
    case 'confluence_update_comment':
      return executeOperation(
        confluenceUpdateCommentContract,
        request,
        executeConfluenceUpdateComment
      )
    case 'confluence_update_space':
      return executeOperation(confluenceUpdateSpaceContract, request, executeConfluenceUpdateSpace)
    case 'confluence_upload_attachment':
      return executeOperation(
        confluenceUploadAttachmentContract,
        request,
        executeConfluenceUploadAttachment
      )
    default:
      return Response.json(
        { error: `Unsupported Confluence tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
