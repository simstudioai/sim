import { z } from 'zod'
import {
  credentialWorkflowDomainBodySchema,
  definePostSelector,
  fileOptionSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse, ContractQuery } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'

const confluenceSpaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    key: z.string(),
    status: z.string().optional(),
  })
  .passthrough()

export const confluencePagesBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  title: optionalString,
  limit: z.number().int().positive().optional().default(50),
})

/**
 * Refines a `pageId` field to match Confluence's alphanumeric format
 * (max 255 chars). Used as a `superRefine` so multiple
 * methods (POST/PUT/DELETE) on `/api/tools/confluence/page` can share it.
 */
export function refineConfluencePageId(data: { pageId: string }, ctx: z.RefinementCtx): void {
  const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
  if (!validation.isValid) {
    ctx.addIssue({
      code: 'custom',
      message: validation.error || 'Invalid page ID',
      path: ['pageId'],
    })
  }
}

export const confluencePageBaseSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  pageId: z.string().min(1, 'Page ID is required'),
})

export const confluencePageBodySchema = confluencePageBaseSchema.superRefine(refineConfluencePageId)

/** Body schema for `PUT /api/tools/confluence/page`. */
export const confluenceUpdatePageBodySchema = confluencePageBaseSchema
  .extend({
    title: optionalString,
    body: z.object({ value: optionalString }).optional(),
    version: z.object({ message: optionalString }).optional(),
  })
  .superRefine(refineConfluencePageId)

/** Body schema for `DELETE /api/tools/confluence/page`. */
export const confluenceDeletePageBodySchema = confluencePageBaseSchema
  .extend({
    purge: z.boolean().optional(),
  })
  .superRefine(refineConfluencePageId)

const confluenceBaseSchema = z.object({
  domain: z.string({ error: 'Domain is required' }).min(1, 'Domain is required'),
  accessToken: z.string({ error: 'Access token is required' }).min(1, 'Access token is required'),
  cloudId: z.string().optional(),
})

const confluencePageScopedSchema = confluenceBaseSchema.extend({
  pageId: z.string({ error: 'Page ID is required' }).min(1, 'Page ID is required'),
})

export const confluenceSpaceScopedSchema = confluenceBaseSchema.extend({
  spaceId: z.string({ error: 'Space ID is required' }).min(1, 'Space ID is required'),
})

function addAlphanumericIdIssue(
  data: Record<string, unknown>,
  field: string,
  label: string,
  ctx: z.RefinementCtx
): void {
  const value = data[field]
  if (typeof value !== 'string') return

  const validation = validateAlphanumericId(value, field, 255)
  if (!validation.isValid) {
    ctx.addIssue({
      code: 'custom',
      message: validation.error || `Invalid ${label}`,
      path: [field],
    })
  }
}

// Keep the un-superRefined base separate so downstream schemas can .extend it.
// .superRefine returns a ZodEffects which has no .extend method, so extending
// the refined schema directly throws at module-init time (caught by bundlers
// like esbuild/Trigger.dev that eagerly evaluate; Next.js lazy-loads per-route
// and hides the issue).
const confluenceCommentScopedBaseSchema = confluenceBaseSchema.extend({
  commentId: z.string().min(1, 'Comment ID is required'),
})
export const confluenceCommentScopedSchema = confluenceCommentScopedBaseSchema.superRefine(
  (data, ctx) => addAlphanumericIdIssue(data, 'commentId', 'comment ID', ctx)
)

const confluenceBlogPostScopedBaseSchema = confluenceBaseSchema.extend({
  blogPostId: z.string({ error: 'Blog post ID is required' }).min(1, 'Blog post ID is required'),
})
export const confluenceBlogPostScopedSchema = confluenceBlogPostScopedBaseSchema.superRefine(
  (data, ctx) => addAlphanumericIdIssue(data, 'blogPostId', 'blog post ID', ctx)
)

export const confluenceDeleteAttachmentBodySchema = confluenceBaseSchema.extend({
  attachmentId: z
    .string({ error: 'Attachment ID is required' })
    .min(1, 'Attachment ID is required'),
})

export const confluenceListAttachmentsQuerySchema = confluencePageScopedSchema.extend({
  limit: z.string().optional().default('50'),
  cursor: z.string().optional(),
})

export const confluenceCreateCommentBodySchema = confluencePageScopedSchema.extend({
  comment: z.string({ error: 'Comment is required' }).min(1, 'Comment is required'),
})

export const confluenceListCommentsQuerySchema = confluencePageScopedSchema.extend({
  limit: z.string().optional().default('25'),
  bodyFormat: z.string().optional().default('storage'),
  cursor: z.string().optional(),
})

export const confluenceUpdateCommentBodySchema = confluenceCommentScopedBaseSchema
  .extend({
    comment: z.string().min(1, 'Comment is required'),
  })
  .superRefine((data, ctx) => addAlphanumericIdIssue(data, 'commentId', 'comment ID', ctx))

export const confluenceCreatePageBodySchema = confluenceSpaceScopedSchema.extend({
  title: z.string({ error: 'Title is required' }).min(1, 'Title is required'),
  content: z.string({ error: 'Content is required' }).min(1, 'Content is required'),
  parentId: z.string().optional(),
})

export const confluenceLabelMutationBodySchema = confluencePageScopedSchema.extend({
  labelName: z.string({ error: 'Label name is required' }).min(1, 'Label name is required'),
  prefix: z.string().optional(),
})

export const confluenceListLabelsQuerySchema = confluencePageScopedSchema.extend({
  limit: z.string().optional().default('25'),
  cursor: z.string().optional(),
})

export const confluenceListPagePropertiesQuerySchema = confluencePageScopedSchema.extend({
  limit: z.string().optional().default('50'),
  cursor: z.string().optional(),
})

export const confluenceCreatePagePropertyBodySchema = confluencePageScopedSchema.extend({
  key: z.string({ error: 'Property key is required' }).min(1, 'Property key is required'),
  value: z.unknown(),
})

export const confluenceUpdatePagePropertyBodySchema = confluenceCreatePagePropertyBodySchema.extend(
  {
    propertyId: z.string({ error: 'Property ID is required' }).min(1, 'Property ID is required'),
    versionNumber: z.number().min(1).optional(),
  }
)

export const confluenceDeletePagePropertyBodySchema = confluencePageScopedSchema.extend({
  propertyId: z.string({ error: 'Property ID is required' }).min(1, 'Property ID is required'),
})

export const confluenceGetSpaceQuerySchema = confluenceSpaceScopedSchema
export const confluenceCreateSpaceBodySchema = confluenceBaseSchema.extend({
  name: z.string({ error: 'Space name is required' }).min(1, 'Space name is required'),
  key: z.string({ error: 'Space key is required' }).min(1, 'Space key is required'),
  description: z.string().optional(),
})
export const confluenceUpdateSpaceBodySchema = confluenceSpaceScopedSchema.extend({
  name: z.string().optional(),
  description: z.string().optional(),
})
export const confluencePageChildrenBodySchema = confluencePageScopedSchema.extend({
  limit: z.number().optional().default(50),
  cursor: z.string().optional(),
})

export const confluencePageAncestorsBodySchema = confluencePageScopedSchema.extend({
  limit: z.number().optional().default(25),
})

export const confluencePageVersionsBodySchema = confluencePageScopedSchema.extend({
  versionNumber: z.union([z.string(), z.number()]).optional(),
  limit: z.number().optional().default(50),
  cursor: z.string().optional(),
})

export const confluencePagesByLabelQuerySchema = confluenceBaseSchema.extend({
  labelId: z.string({ error: 'Label ID is required' }).min(1, 'Label ID is required'),
  limit: z.string().optional().default('50'),
  cursor: z.string().optional(),
})

export const confluenceSearchBodySchema = confluenceBaseSchema.extend({
  query: z.string({ error: 'Search query is required' }).min(1, 'Search query is required'),
  limit: z.number().optional().default(25),
})

export const confluenceSearchInSpaceBodySchema = confluenceBaseSchema.extend({
  spaceKey: z.string({ error: 'Space key is required' }).min(1, 'Space key is required'),
  query: z.string().optional(),
  limit: z.number().optional().default(25),
  contentType: z.string().optional(),
})

export const confluenceSpaceBlogPostsBodySchema = confluenceSpaceScopedSchema.extend({
  limit: z.number().optional().default(25),
  status: z.string().optional(),
  bodyFormat: z.string().optional(),
  cursor: z.string().optional(),
})

export const confluenceSpaceLabelsQuerySchema = confluenceSpaceScopedSchema.extend({
  limit: z.string().optional().default('25'),
  cursor: z.string().optional(),
})

export const confluenceSpacePagesBodySchema = confluenceSpaceScopedSchema.extend({
  limit: z.number().optional().default(50),
  status: z.string().optional(),
  bodyFormat: z.string().optional(),
  cursor: z.string().optional(),
})

export const confluenceSpacePermissionsBodySchema = confluenceSpaceScopedSchema.extend({
  limit: z.number().optional().default(50),
  cursor: z.string().optional(),
})

export const confluenceSpacePropertiesBodySchema = confluenceSpaceScopedSchema.extend({
  action: z.string().optional(),
  key: z.string().optional(),
  value: z.unknown().optional(),
  propertyId: z.string().optional(),
  limit: z.number().optional().default(50),
  cursor: z.string().optional(),
})

export const confluenceListSpacesQuerySchema = confluenceBaseSchema.extend({
  limit: z.string().optional().default('25'),
  cursor: z.string().optional(),
})

export const confluenceTasksBodySchema = confluenceBaseSchema.extend({
  action: z.string().optional(),
  taskId: z.string().optional(),
  status: z.string().optional(),
  pageId: z.string().optional(),
  spaceId: z.string().optional(),
  assignedTo: z.string().optional(),
  limit: z.number().optional().default(50),
  cursor: z.string().optional(),
})

export const confluenceUploadAttachmentBodySchema = confluencePageScopedSchema.extend({
  file: z.unknown().refine((value) => Boolean(value), { message: 'File is required' }),
  fileName: z.string().optional(),
  comment: z.string().optional(),
})

export const confluenceUserBodySchema = confluenceBaseSchema.extend({
  accountId: z.string({ error: 'Account ID is required' }).min(1, 'Account ID is required'),
})

export const confluenceGetBlogPostBodySchema = confluenceBlogPostScopedBaseSchema
  .extend({
    bodyFormat: z.string().optional(),
  })
  .superRefine((data, ctx) => addAlphanumericIdIssue(data, 'blogPostId', 'blog post ID', ctx))

export const confluenceCreateBlogPostBodySchema = confluenceSpaceScopedSchema.extend({
  title: z.string({ error: 'Title is required' }).min(1, 'Title is required'),
  content: z.string({ error: 'Content is required' }).min(1, 'Content is required'),
  status: z.enum(['current', 'draft']).optional(),
})

export const confluenceBlogPostOperationBodySchema = z.union([
  confluenceCreateBlogPostBodySchema,
  confluenceGetBlogPostBodySchema,
])

export const confluenceListBlogPostsQuerySchema = confluenceBaseSchema.extend({
  limit: z.string().optional().default('25'),
  status: z.string().optional(),
  sort: z.string().optional(),
  cursor: z.string().optional(),
})

export const confluenceUpdateBlogPostBodySchema = confluenceBlogPostScopedBaseSchema
  .extend({
    title: z.string().optional(),
    content: z.string().optional(),
  })
  .superRefine((data, ctx) => addAlphanumericIdIssue(data, 'blogPostId', 'blog post ID', ctx))

const defineConfluencePostContract = <TBody extends z.ZodType>(path: string, body: TBody) =>
  defineRouteContract({
    method: 'POST',
    path,
    body,
    response: {
      mode: 'json',
      // untyped-response: shared helper for ~16 confluence POST routes, each forwarding a different Atlassian Confluence v2 payload (pages, comments, labels, blogposts, page properties, search, etc.) whose shapes diverge per resource and are version-dependent
      schema: z.unknown(),
    },
  })

const defineConfluencePutContract = <TBody extends z.ZodType>(path: string, body: TBody) =>
  defineRouteContract({
    method: 'PUT',
    path,
    body,
    response: {
      mode: 'json',
      // untyped-response: shared helper for confluence PUT routes (page, comment, blogpost, space, page-properties) that proxy raw Atlassian Confluence v2 update responses whose shape varies per resource
      schema: z.unknown(),
    },
  })

const defineConfluenceDeleteContract = <TBody extends z.ZodType>(path: string, body: TBody) =>
  defineRouteContract({
    method: 'DELETE',
    path,
    body,
    response: {
      mode: 'json',
      // untyped-response: shared helper for confluence DELETE routes returning either a normalized deleted marker, an empty body, or a forwarded Atlassian Confluence v2 response depending on the resource
      schema: z.unknown(),
    },
  })

const defineConfluenceGetContract = <TQuery extends z.ZodType>(path: string, query: TQuery) =>
  defineRouteContract({
    method: 'GET',
    path,
    query,
    response: {
      mode: 'json',
      // untyped-response: shared helper for confluence GET listing routes (attachments, blogposts, comments, labels, page-properties, space, spaces, space-labels, pages-by-label) each returning a different paginated Atlassian Confluence v2 shape
      schema: z.unknown(),
    },
  })

export const confluenceSpacesSelectorBodySchema = credentialWorkflowDomainBodySchema.extend({
  cursor: optionalString,
})

export const confluenceSpacesSelectorContract = definePostSelector(
  '/api/tools/confluence/selector-spaces',
  confluenceSpacesSelectorBodySchema,
  z.object({
    spaces: z.array(confluenceSpaceSchema),
    nextCursor: optionalString,
  })
)

export const confluencePagesSelectorContract = definePostSelector(
  '/api/tools/confluence/pages',
  confluencePagesBodySchema,
  z.object({ files: z.array(fileOptionSchema) })
)

export const confluencePageSelectorContract = definePostSelector(
  '/api/tools/confluence/page',
  confluencePageBodySchema,
  z.object({ id: z.string(), title: z.string() }).passthrough()
)

export const confluenceUpdatePageContract = defineConfluencePutContract(
  '/api/tools/confluence/page',
  confluenceUpdatePageBodySchema
)
export const confluenceDeletePageContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/page',
  confluenceDeletePageBodySchema
)
export const confluenceDeleteAttachmentContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/attachment',
  confluenceDeleteAttachmentBodySchema
)
export const confluenceListAttachmentsContract = defineConfluenceGetContract(
  '/api/tools/confluence/attachments',
  confluenceListAttachmentsQuerySchema
)
export const confluenceListBlogPostsContract = defineConfluenceGetContract(
  '/api/tools/confluence/blogposts',
  confluenceListBlogPostsQuerySchema
)
export const confluenceBlogPostOperationContract = defineConfluencePostContract(
  '/api/tools/confluence/blogposts',
  confluenceBlogPostOperationBodySchema
)
export const confluenceUpdateBlogPostContract = defineConfluencePutContract(
  '/api/tools/confluence/blogposts',
  confluenceUpdateBlogPostBodySchema
)
export const confluenceDeleteBlogPostContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/blogposts',
  confluenceBlogPostScopedSchema
)
export const confluenceCreateCommentContract = defineConfluencePostContract(
  '/api/tools/confluence/comments',
  confluenceCreateCommentBodySchema
)
export const confluenceListCommentsContract = defineConfluenceGetContract(
  '/api/tools/confluence/comments',
  confluenceListCommentsQuerySchema
)
export const confluenceUpdateCommentContract = defineConfluencePutContract(
  '/api/tools/confluence/comment',
  confluenceUpdateCommentBodySchema
)
export const confluenceDeleteCommentContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/comment',
  confluenceCommentScopedSchema
)
export const confluenceCreatePageContract = defineConfluencePostContract(
  '/api/tools/confluence/create-page',
  confluenceCreatePageBodySchema
)
export const confluenceLabelMutationContract = defineConfluencePostContract(
  '/api/tools/confluence/labels',
  confluenceLabelMutationBodySchema
)
export const confluenceListLabelsContract = defineConfluenceGetContract(
  '/api/tools/confluence/labels',
  confluenceListLabelsQuerySchema
)
export const confluenceDeleteLabelContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/labels',
  confluenceLabelMutationBodySchema
)
export const confluenceListPagePropertiesContract = defineConfluenceGetContract(
  '/api/tools/confluence/page-properties',
  confluenceListPagePropertiesQuerySchema
)
export const confluenceCreatePagePropertyContract = defineConfluencePostContract(
  '/api/tools/confluence/page-properties',
  confluenceCreatePagePropertyBodySchema
)
export const confluenceUpdatePagePropertyContract = defineConfluencePutContract(
  '/api/tools/confluence/page-properties',
  confluenceUpdatePagePropertyBodySchema
)
export const confluenceDeletePagePropertyContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/page-properties',
  confluenceDeletePagePropertyBodySchema
)
export const confluenceGetSpaceContract = defineConfluenceGetContract(
  '/api/tools/confluence/space',
  confluenceGetSpaceQuerySchema
)
export const confluenceCreateSpaceContract = defineConfluencePostContract(
  '/api/tools/confluence/space',
  confluenceCreateSpaceBodySchema
)
export const confluenceUpdateSpaceContract = defineConfluencePutContract(
  '/api/tools/confluence/space',
  confluenceUpdateSpaceBodySchema
)
export const confluenceDeleteSpaceContract = defineConfluenceDeleteContract(
  '/api/tools/confluence/space',
  confluenceSpaceScopedSchema
)
export const confluencePageChildrenContract = defineConfluencePostContract(
  '/api/tools/confluence/page-children',
  confluencePageChildrenBodySchema
)
export const confluencePageDescendantsContract = defineConfluencePostContract(
  '/api/tools/confluence/page-descendants',
  confluencePageChildrenBodySchema
)
export const confluencePageAncestorsContract = defineConfluencePostContract(
  '/api/tools/confluence/page-ancestors',
  confluencePageAncestorsBodySchema
)
export const confluencePageVersionsContract = defineConfluencePostContract(
  '/api/tools/confluence/page-versions',
  confluencePageVersionsBodySchema
)
export const confluencePagesByLabelContract = defineConfluenceGetContract(
  '/api/tools/confluence/pages-by-label',
  confluencePagesByLabelQuerySchema
)
export const confluenceSearchContract = defineConfluencePostContract(
  '/api/tools/confluence/search',
  confluenceSearchBodySchema
)
export const confluenceSearchInSpaceContract = defineConfluencePostContract(
  '/api/tools/confluence/search-in-space',
  confluenceSearchInSpaceBodySchema
)
export const confluenceSpaceBlogPostsContract = defineConfluencePostContract(
  '/api/tools/confluence/space-blogposts',
  confluenceSpaceBlogPostsBodySchema
)
export const confluenceSpaceLabelsContract = defineConfluenceGetContract(
  '/api/tools/confluence/space-labels',
  confluenceSpaceLabelsQuerySchema
)
export const confluenceSpacePagesContract = defineConfluencePostContract(
  '/api/tools/confluence/space-pages',
  confluenceSpacePagesBodySchema
)
export const confluenceSpacePermissionsContract = defineConfluencePostContract(
  '/api/tools/confluence/space-permissions',
  confluenceSpacePermissionsBodySchema
)
export const confluenceSpacePropertiesContract = defineConfluencePostContract(
  '/api/tools/confluence/space-properties',
  confluenceSpacePropertiesBodySchema
)
export const confluenceListSpacesContract = defineConfluenceGetContract(
  '/api/tools/confluence/spaces',
  confluenceListSpacesQuerySchema
)
export const confluenceTasksContract = defineConfluencePostContract(
  '/api/tools/confluence/tasks',
  confluenceTasksBodySchema
)
export const confluenceUploadAttachmentContract = defineConfluencePostContract(
  '/api/tools/confluence/upload-attachment',
  confluenceUploadAttachmentBodySchema
)
export const confluenceUserContract = defineConfluencePostContract(
  '/api/tools/confluence/user',
  confluenceUserBodySchema
)

export type ConfluencePagesBody = ContractBody<typeof confluencePagesSelectorContract>
export type ConfluencePageBody = ContractBody<typeof confluencePageSelectorContract>
export type ConfluenceUpdatePageBody = ContractBody<typeof confluenceUpdatePageContract>
export type ConfluenceDeletePageBody = ContractBody<typeof confluenceDeletePageContract>
export type ConfluenceDeleteAttachmentBody = ContractBody<typeof confluenceDeleteAttachmentContract>
export type ConfluenceListAttachmentsQuery = ContractQuery<typeof confluenceListAttachmentsContract>
export type ConfluenceListBlogPostsQuery = ContractQuery<typeof confluenceListBlogPostsContract>
export type ConfluenceBlogPostOperationBody = ContractBody<
  typeof confluenceBlogPostOperationContract
>
export type ConfluenceUpdateBlogPostBody = ContractBody<typeof confluenceUpdateBlogPostContract>
export type ConfluenceDeleteBlogPostBody = ContractBody<typeof confluenceDeleteBlogPostContract>
export type ConfluenceCreateCommentBody = ContractBody<typeof confluenceCreateCommentContract>
export type ConfluenceListCommentsQuery = ContractQuery<typeof confluenceListCommentsContract>
export type ConfluenceUpdateCommentBody = ContractBody<typeof confluenceUpdateCommentContract>
export type ConfluenceDeleteCommentBody = ContractBody<typeof confluenceDeleteCommentContract>
export type ConfluenceCreatePageBody = ContractBody<typeof confluenceCreatePageContract>
export type ConfluenceLabelMutationBody = ContractBody<typeof confluenceLabelMutationContract>
export type ConfluenceListLabelsQuery = ContractQuery<typeof confluenceListLabelsContract>
export type ConfluenceDeleteLabelBody = ContractBody<typeof confluenceDeleteLabelContract>
export type ConfluenceListPagePropertiesQuery = ContractQuery<
  typeof confluenceListPagePropertiesContract
>
export type ConfluenceCreatePagePropertyBody = ContractBody<
  typeof confluenceCreatePagePropertyContract
>
export type ConfluenceUpdatePagePropertyBody = ContractBody<
  typeof confluenceUpdatePagePropertyContract
>
export type ConfluenceDeletePagePropertyBody = ContractBody<
  typeof confluenceDeletePagePropertyContract
>
export type ConfluenceGetSpaceQuery = ContractQuery<typeof confluenceGetSpaceContract>
export type ConfluenceCreateSpaceBody = ContractBody<typeof confluenceCreateSpaceContract>
export type ConfluenceUpdateSpaceBody = ContractBody<typeof confluenceUpdateSpaceContract>
export type ConfluenceDeleteSpaceBody = ContractBody<typeof confluenceDeleteSpaceContract>
export type ConfluencePageChildrenBody = ContractBody<typeof confluencePageChildrenContract>
export type ConfluencePageDescendantsBody = ContractBody<typeof confluencePageDescendantsContract>
export type ConfluencePageAncestorsBody = ContractBody<typeof confluencePageAncestorsContract>
export type ConfluencePageVersionsBody = ContractBody<typeof confluencePageVersionsContract>
export type ConfluencePagesByLabelQuery = ContractQuery<typeof confluencePagesByLabelContract>
export type ConfluenceSearchBody = ContractBody<typeof confluenceSearchContract>
export type ConfluenceSearchInSpaceBody = ContractBody<typeof confluenceSearchInSpaceContract>
export type ConfluenceSpaceBlogPostsBody = ContractBody<typeof confluenceSpaceBlogPostsContract>
export type ConfluenceSpaceLabelsQuery = ContractQuery<typeof confluenceSpaceLabelsContract>
export type ConfluenceSpacePagesBody = ContractBody<typeof confluenceSpacePagesContract>
export type ConfluenceSpacePermissionsBody = ContractBody<typeof confluenceSpacePermissionsContract>
export type ConfluenceSpacePropertiesBody = ContractBody<typeof confluenceSpacePropertiesContract>
export type ConfluenceListSpacesQuery = ContractQuery<typeof confluenceListSpacesContract>
export type ConfluenceTasksBody = ContractBody<typeof confluenceTasksContract>
export type ConfluenceUploadAttachmentBody = ContractBody<typeof confluenceUploadAttachmentContract>
export type ConfluenceUserBody = ContractBody<typeof confluenceUserContract>
export type ConfluenceSpacesSelectorResponse = ContractJsonResponse<
  typeof confluenceSpacesSelectorContract
>
export type ConfluencePagesSelectorResponse = ContractJsonResponse<
  typeof confluencePagesSelectorContract
>
export type ConfluencePageSelectorResponse = ContractJsonResponse<
  typeof confluencePageSelectorContract
>
