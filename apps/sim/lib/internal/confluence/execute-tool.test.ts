/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import type { ExecutionContext } from '@/executor/types'

const mockOperations = vi.hoisted(() => ({
  executeConfluenceAddLabel: vi.fn(),
  executeConfluenceCreateBlogPost: vi.fn(),
  executeConfluenceCreateComment: vi.fn(),
  executeConfluenceCreatePage: vi.fn(),
  executeConfluenceCreatePageProperty: vi.fn(),
  executeConfluenceCreateSpace: vi.fn(),
  executeConfluenceDeleteAttachment: vi.fn(),
  executeConfluenceDeleteBlogPost: vi.fn(),
  executeConfluenceDeleteComment: vi.fn(),
  executeConfluenceDeleteLabel: vi.fn(),
  executeConfluenceDeletePage: vi.fn(),
  executeConfluenceDeletePageProperty: vi.fn(),
  executeConfluenceDeleteSpace: vi.fn(),
  executeConfluenceGetBlogPost: vi.fn(),
  executeConfluenceGetPageAncestors: vi.fn(),
  executeConfluenceGetPageChildren: vi.fn(),
  executeConfluenceGetPageDescendants: vi.fn(),
  executeConfluenceGetPagesByLabel: vi.fn(),
  executeConfluenceGetSpace: vi.fn(),
  executeConfluenceGetUser: vi.fn(),
  executeConfluenceListAttachments: vi.fn(),
  executeConfluenceListBlogPosts: vi.fn(),
  executeConfluenceListBlogPostsInSpace: vi.fn(),
  executeConfluenceListComments: vi.fn(),
  executeConfluenceListLabels: vi.fn(),
  executeConfluenceListPageProperties: vi.fn(),
  executeConfluenceListPagesInSpace: vi.fn(),
  executeConfluenceListSpaceLabels: vi.fn(),
  executeConfluenceListSpacePermissions: vi.fn(),
  executeConfluenceListSpaces: vi.fn(),
  executeConfluencePageVersions: vi.fn(),
  executeConfluenceRetrievePage: vi.fn(),
  executeConfluenceSearch: vi.fn(),
  executeConfluenceSearchInSpace: vi.fn(),
  executeConfluenceSpaceProperties: vi.fn(),
  executeConfluenceTasks: vi.fn(),
  executeConfluenceUpdateBlogPost: vi.fn(),
  executeConfluenceUpdateComment: vi.fn(),
  executeConfluenceUpdatePage: vi.fn(),
  executeConfluenceUpdateSpace: vi.fn(),
  executeConfluenceUploadAttachment: vi.fn(),
}))

vi.mock('@/lib/internal/confluence/operations', () => mockOperations)

import { executeConfluenceTool } from '@/lib/internal/confluence/execute-tool'

const BASE = {
  domain: 'example.atlassian.net',
  accessToken: 'access-token',
  cloudId: '12345678-1234-1234-1234-123456789012',
}
const PAGE = { ...BASE, pageId: '123' }
const SPACE = { ...BASE, spaceId: '456' }
const BLOG_POST = { ...BASE, blogPostId: '789' }
const COMMENT = { ...BASE, commentId: '321' }

type OperationName = keyof typeof mockOperations

interface DispatchCase {
  toolId: string
  operation: OperationName
  input: Record<string, unknown>
  query?: boolean
}

const DISPATCH_CASES: DispatchCase[] = [
  {
    toolId: 'confluence_add_label',
    operation: 'executeConfluenceAddLabel',
    input: { ...PAGE, labelName: 'release' },
  },
  {
    toolId: 'confluence_create_blogpost',
    operation: 'executeConfluenceCreateBlogPost',
    input: { ...SPACE, title: 'Title', content: '<p>Body</p>' },
  },
  {
    toolId: 'confluence_create_comment',
    operation: 'executeConfluenceCreateComment',
    input: { ...PAGE, comment: '<p>Comment</p>' },
  },
  {
    toolId: 'confluence_create_page',
    operation: 'executeConfluenceCreatePage',
    input: { ...SPACE, title: 'Title', content: '<p>Body</p>' },
  },
  {
    toolId: 'confluence_create_page_property',
    operation: 'executeConfluenceCreatePageProperty',
    input: { ...PAGE, key: 'owner', value: { id: 'user-1' } },
  },
  {
    toolId: 'confluence_create_space',
    operation: 'executeConfluenceCreateSpace',
    input: { ...BASE, name: 'Engineering', key: 'ENG' },
  },
  {
    toolId: 'confluence_create_space_property',
    operation: 'executeConfluenceSpaceProperties',
    input: { ...SPACE, action: 'create', key: 'owner', value: 'user-1' },
  },
  {
    toolId: 'confluence_delete_attachment',
    operation: 'executeConfluenceDeleteAttachment',
    input: { ...BASE, attachmentId: '111' },
  },
  {
    toolId: 'confluence_delete_blogpost',
    operation: 'executeConfluenceDeleteBlogPost',
    input: BLOG_POST,
  },
  {
    toolId: 'confluence_delete_comment',
    operation: 'executeConfluenceDeleteComment',
    input: COMMENT,
  },
  {
    toolId: 'confluence_delete_label',
    operation: 'executeConfluenceDeleteLabel',
    input: { ...PAGE, labelName: 'release' },
  },
  {
    toolId: 'confluence_delete_page',
    operation: 'executeConfluenceDeletePage',
    input: PAGE,
  },
  {
    toolId: 'confluence_delete_page_property',
    operation: 'executeConfluenceDeletePageProperty',
    input: { ...PAGE, propertyId: '222' },
  },
  {
    toolId: 'confluence_delete_space',
    operation: 'executeConfluenceDeleteSpace',
    input: SPACE,
  },
  {
    toolId: 'confluence_delete_space_property',
    operation: 'executeConfluenceSpaceProperties',
    input: { ...SPACE, action: 'delete', propertyId: '333' },
  },
  {
    toolId: 'confluence_get_blogpost',
    operation: 'executeConfluenceGetBlogPost',
    input: BLOG_POST,
  },
  {
    toolId: 'confluence_get_page_ancestors',
    operation: 'executeConfluenceGetPageAncestors',
    input: PAGE,
  },
  {
    toolId: 'confluence_get_page_children',
    operation: 'executeConfluenceGetPageChildren',
    input: PAGE,
  },
  {
    toolId: 'confluence_get_page_descendants',
    operation: 'executeConfluenceGetPageDescendants',
    input: PAGE,
  },
  {
    toolId: 'confluence_get_page_version',
    operation: 'executeConfluencePageVersions',
    input: { ...PAGE, versionNumber: 2 },
  },
  {
    toolId: 'confluence_get_pages_by_label',
    operation: 'executeConfluenceGetPagesByLabel',
    input: { ...BASE, labelId: '444' },
    query: true,
  },
  {
    toolId: 'confluence_get_space',
    operation: 'executeConfluenceGetSpace',
    input: SPACE,
    query: true,
  },
  {
    toolId: 'confluence_get_task',
    operation: 'executeConfluenceTasks',
    input: { ...BASE, taskId: '555' },
  },
  {
    toolId: 'confluence_get_user',
    operation: 'executeConfluenceGetUser',
    input: { ...BASE, accountId: 'account-1' },
  },
  {
    toolId: 'confluence_list_attachments',
    operation: 'executeConfluenceListAttachments',
    input: PAGE,
    query: true,
  },
  {
    toolId: 'confluence_list_blogposts',
    operation: 'executeConfluenceListBlogPosts',
    input: BASE,
    query: true,
  },
  {
    toolId: 'confluence_list_blogposts_in_space',
    operation: 'executeConfluenceListBlogPostsInSpace',
    input: SPACE,
  },
  {
    toolId: 'confluence_list_comments',
    operation: 'executeConfluenceListComments',
    input: PAGE,
    query: true,
  },
  {
    toolId: 'confluence_list_labels',
    operation: 'executeConfluenceListLabels',
    input: PAGE,
    query: true,
  },
  {
    toolId: 'confluence_list_page_properties',
    operation: 'executeConfluenceListPageProperties',
    input: PAGE,
    query: true,
  },
  {
    toolId: 'confluence_list_page_versions',
    operation: 'executeConfluencePageVersions',
    input: PAGE,
  },
  {
    toolId: 'confluence_list_pages_in_space',
    operation: 'executeConfluenceListPagesInSpace',
    input: SPACE,
  },
  {
    toolId: 'confluence_list_space_labels',
    operation: 'executeConfluenceListSpaceLabels',
    input: SPACE,
    query: true,
  },
  {
    toolId: 'confluence_list_space_permissions',
    operation: 'executeConfluenceListSpacePermissions',
    input: SPACE,
  },
  {
    toolId: 'confluence_list_space_properties',
    operation: 'executeConfluenceSpaceProperties',
    input: SPACE,
  },
  {
    toolId: 'confluence_list_spaces',
    operation: 'executeConfluenceListSpaces',
    input: BASE,
    query: true,
  },
  {
    toolId: 'confluence_list_tasks',
    operation: 'executeConfluenceTasks',
    input: BASE,
  },
  {
    toolId: 'confluence_retrieve',
    operation: 'executeConfluenceRetrievePage',
    input: PAGE,
  },
  {
    toolId: 'confluence_search',
    operation: 'executeConfluenceSearch',
    input: { ...BASE, query: 'release notes' },
  },
  {
    toolId: 'confluence_search_in_space',
    operation: 'executeConfluenceSearchInSpace',
    input: { ...BASE, spaceKey: 'ENG' },
  },
  {
    toolId: 'confluence_update',
    operation: 'executeConfluenceUpdatePage',
    input: PAGE,
  },
  {
    toolId: 'confluence_update_blogpost',
    operation: 'executeConfluenceUpdateBlogPost',
    input: BLOG_POST,
  },
  {
    toolId: 'confluence_update_comment',
    operation: 'executeConfluenceUpdateComment',
    input: { ...COMMENT, comment: '<p>Updated</p>' },
  },
  {
    toolId: 'confluence_update_space',
    operation: 'executeConfluenceUpdateSpace',
    input: { ...SPACE, name: 'Engineering' },
  },
  {
    toolId: 'confluence_update_task',
    operation: 'executeConfluenceTasks',
    input: { ...BASE, action: 'update', taskId: '555', status: 'complete' },
  },
  {
    toolId: 'confluence_upload_attachment',
    operation: 'executeConfluenceUploadAttachment',
    input: { ...PAGE, file: { key: 'uploads/file.txt', name: 'file.txt', size: 4 } },
  },
]

function makeRequest(
  toolId: string,
  input: Record<string, unknown>,
  _query = false,
  signal?: AbortSignal
): InternalToolOperationCall {
  return {
    toolId,
    input,
    headers: new Headers({ 'x-execution-id': 'execution-1' }),
    context: {
      workflowId: 'workflow-1',
      userId: 'user-1',
    } as ExecutionContext,
    requestId: 'request-1',
    signal,
  }
}

describe('executeConfluenceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const [operation, mock] of Object.entries(mockOperations)) {
      mock.mockResolvedValue({ operation })
    }
  })

  it.each(DISPATCH_CASES)('dispatches $toolId through $operation', async (testCase) => {
    const response = await executeConfluenceTool(
      makeRequest(testCase.toolId, testCase.input, testCase.query)
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ operation: testCase.operation })
    expect(mockOperations[testCase.operation]).toHaveBeenCalledOnce()
    expect(mockOperations[testCase.operation]).toHaveBeenCalledWith(
      expect.objectContaining(testCase.input),
      {
        headers: expect.any(Headers),
        requestId: 'request-1',
        signal: undefined,
        userId: 'user-1',
      }
    )
  })

  it('returns the canonical invalid operation input envelope', async () => {
    const request = makeRequest('confluence_retrieve', {})
    request.input = '{'
    const response = await executeConfluenceTool(request)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
  })

  it('returns the canonical validation envelope', async () => {
    const response = await executeConfluenceTool(
      makeRequest('confluence_retrieve', { domain: 'example.atlassian.net' })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
  })

  it('preserves typed operation status and error envelopes', async () => {
    mockOperations.executeConfluenceCreateSpace.mockRejectedValueOnce(
      new ConfluenceOperationError('Confluence rejected the request', 409)
    )

    const response = await executeConfluenceTool(
      makeRequest('confluence_create_space', { ...BASE, name: 'Engineering', key: 'ENG' })
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Confluence rejected the request' })
  })

  it('preserves specialized upload error envelopes', async () => {
    mockOperations.executeConfluenceUploadAttachment.mockRejectedValueOnce(
      new ConfluenceOperationError('File not found', 404, {
        success: false,
        error: 'File not found',
      })
    )

    const response = await executeConfluenceTool(
      makeRequest('confluence_upload_attachment', {
        ...PAGE,
        file: { key: 'uploads/file.txt' },
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ success: false, error: 'File not found' })
  })

  it('stops before dispatch when execution is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      executeConfluenceTool(makeRequest('confluence_retrieve', PAGE, false, controller.signal))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeConfluenceRetrievePage).not.toHaveBeenCalled()
  })

  it('returns an explicit error for unknown Confluence tools', async () => {
    const response = await executeConfluenceTool(makeRequest('confluence_unknown', BASE))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Unsupported Confluence tool: confluence_unknown',
    })
  })
})
