/**
 * @vitest-environment node
 */
import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { planeAddWorkItemsToCycleTool } from '@/tools/plane/add_work_items_to_cycle'
import { planeCreateCommentTool } from '@/tools/plane/create_comment'
import { planeCreateWorkItemTool } from '@/tools/plane/create_work_item'
import { planeDeleteWorkItemTool } from '@/tools/plane/delete_work_item'
import { planeDownloadAttachmentTool } from '@/tools/plane/download_attachment'
import { planeGetCurrentUserTool } from '@/tools/plane/get_current_user'
import { planeGetWorkItemByIdentifierTool } from '@/tools/plane/get_work_item_by_identifier'
import { planeListCyclesTool } from '@/tools/plane/list_cycles'
import { planeListProjectMembersTool } from '@/tools/plane/list_project_members'
import { planeListWorkItemsTool } from '@/tools/plane/list_work_items'
import { planeSearchWorkItemsTool } from '@/tools/plane/search_work_items'
import { planeUpdateWorkItemTool } from '@/tools/plane/update_work_item'
import {
  normalizePlaneBaseUrl,
  parsePlaneContentDispositionFilename,
  parsePlaneIdList,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

const CONNECTION = { apiKey: ' plane_api_key ', workspaceSlug: 'acme' }
const SCOPE = { ...CONNECTION, projectId: 'project-1', workItemId: 'item-1' }

function resolveUrl<P>(tool: ToolConfig<P>, params: P): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params) : url
}

const WORK_ITEM = {
  id: 'item-1',
  name: 'Fix login',
  description_html: '<p>Steps</p>',
  priority: 'high',
  state: 'state-1',
  parent: null,
  estimate_point: null,
  type_id: null,
  type: null,
  sequence_id: 42,
  sort_order: 65535,
  start_date: null,
  target_date: '2026-10-31',
  completed_at: null,
  archived_at: null,
  is_draft: false,
  assignees: ['user-1'],
  labels: ['label-1'],
  project: 'project-1',
  workspace: 'workspace-1',
  external_source: null,
  external_id: null,
  created_by: 'user-1',
  updated_by: null,
  created_at: '2026-10-05T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
}

describe('Plane URL helpers', () => {
  it('defaults to Plane Cloud and normalizes self-hosted hosts', () => {
    expect(normalizePlaneBaseUrl(undefined)).toBe('https://api.plane.so')
    expect(normalizePlaneBaseUrl('  ')).toBe('https://api.plane.so')
    expect(normalizePlaneBaseUrl('plane.example.com/')).toBe('https://plane.example.com')
    expect(normalizePlaneBaseUrl('http://localhost:8090/api/v1/')).toBe('http://localhost:8090')
    expect(normalizePlaneBaseUrl('https://plane.example.com/api')).toBe('https://plane.example.com')
  })

  it('rejects dot-segment and slash IDs that would re-target a parent resource', () => {
    for (const workItemId of ['..', '.', '../other', 'a/b', '']) {
      expect(() => resolveUrl(planeDeleteWorkItemTool, { ...SCOPE, workItemId })).toThrow(
        /workItemId/
      )
    }
    expect(() =>
      resolveUrl(planeListWorkItemsTool, { ...CONNECTION, workspaceSlug: '..', projectId: 'p-1' })
    ).toThrow(/workspaceSlug/)
  })

  it('parses ID lists from arrays, JSON strings, and comma-separated strings', () => {
    expect(parsePlaneIdList(undefined)).toBeUndefined()
    expect(parsePlaneIdList('')).toBeUndefined()
    expect(parsePlaneIdList(['a', ' b '])).toEqual(['a', 'b'])
    expect(parsePlaneIdList('["a","b"]')).toEqual(['a', 'b'])
    expect(parsePlaneIdList('a, b,,c')).toEqual(['a', 'b', 'c'])
  })

  it('reads RFC 5987 and plain Content-Disposition filenames', () => {
    expect(
      parsePlaneContentDispositionFilename(
        "attachment; filename*=UTF-8''Q3%20report%20%E2%9C%93.pdf"
      )
    ).toBe('Q3 report ✓.pdf')
    expect(parsePlaneContentDispositionFilename('attachment; filename="notes.txt"')).toBe(
      'notes.txt'
    )
    expect(parsePlaneContentDispositionFilename(null)).toBeNull()
  })
})

describe('Plane work item tools', () => {
  it('creates a work item with only the provided fields', () => {
    const params = {
      ...SCOPE,
      name: ' Fix login ',
      description: '<p>Steps</p>',
      priority: 'high' as const,
      assigneeIds: ['user-1'],
      labelIds: 'label-1, label-2',
      targetDate: '2026-10-31',
      externalId: 'GH-1',
      externalSource: 'github',
    }
    expect(resolveUrl(planeCreateWorkItemTool, params)).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/'
    )
    expect(planeCreateWorkItemTool.request.headers(params)).toMatchObject({
      'X-API-Key': 'plane_api_key',
    })
    expect(planeCreateWorkItemTool.request.body?.(params)).toEqual({
      name: 'Fix login',
      description_html: '<p>Steps</p>',
      priority: 'high',
      assignees: ['user-1'],
      labels: ['label-1', 'label-2'],
      target_date: '2026-10-31',
      external_id: 'GH-1',
      external_source: 'github',
    })
  })

  it('maps a work item response', async () => {
    const result = await planeCreateWorkItemTool.transformResponse?.(jsonResponse(WORK_ITEM, 201))
    expect(result?.output.workItem).toMatchObject({
      id: 'item-1',
      name: 'Fix login',
      descriptionHtml: '<p>Steps</p>',
      priority: 'high',
      stateId: 'state-1',
      sequenceId: 42,
      assigneeIds: ['user-1'],
      labelIds: ['label-1'],
      projectId: 'project-1',
      targetDate: '2026-10-31',
    })
  })

  it('patches only changed fields and refuses an empty update', () => {
    const params = { ...SCOPE, stateId: 'state-2' }
    expect(resolveUrl(planeUpdateWorkItemTool, params)).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/item-1/'
    )
    expect(planeUpdateWorkItemTool.request.body?.(params)).toEqual({ state: 'state-2' })
    expect(() => planeUpdateWorkItemTool.request.body?.(SCOPE)).toThrow(
      'Provide at least one field to update'
    )
  })

  it('resolves a human-readable identifier to the workspace lookup route', () => {
    expect(
      resolveUrl(planeGetWorkItemByIdentifierTool, { ...CONNECTION, identifier: ' eng-42 ' })
    ).toBe('https://api.plane.so/api/v1/workspaces/acme/work-items/ENG-42/')
    expect(() =>
      resolveUrl(planeGetWorkItemByIdentifierTool, { ...CONNECTION, identifier: 'not an id' })
    ).toThrow('Identifier must look like PROJ-123')
  })

  it('reports the deleted work item without reading the empty 204 body', async () => {
    const result = await planeDeleteWorkItemTool.transformResponse?.(
      new Response(null, { status: 204 }),
      SCOPE
    )
    expect(result?.output).toEqual({ deleted: true, id: 'item-1' })
  })

  it('lists work items with clamped pagination and maps the cursor envelope', async () => {
    expect(
      resolveUrl(planeListWorkItemsTool, {
        ...CONNECTION,
        baseUrl: 'http://localhost:8090',
        projectId: 'project-1',
        perPage: 500,
        cursor: '100:1:0',
        orderBy: '-updated_at',
      })
    ).toBe(
      'http://localhost:8090/api/v1/workspaces/acme/projects/project-1/work-items/?per_page=100&cursor=100%3A1%3A0&order_by=-updated_at'
    )

    const result = await planeListWorkItemsTool.transformResponse?.(
      jsonResponse({
        grouped_by: null,
        sub_grouped_by: null,
        total_count: 2,
        next_cursor: '1:1:0',
        prev_cursor: '1:-1:1',
        next_page_results: true,
        prev_page_results: false,
        count: 1,
        total_pages: 2,
        total_results: 2,
        extra_stats: null,
        results: [WORK_ITEM],
      })
    )
    expect(result?.output).toMatchObject({
      nextCursor: '1:1:0',
      prevCursor: null,
      nextPageResults: true,
      prevPageResults: false,
      count: 1,
      totalPages: 2,
      totalResults: 2,
    })
    expect(result?.output.workItems).toHaveLength(1)
  })

  it('searches with an optional project filter and composes identifiers', async () => {
    expect(
      resolveUrl(planeSearchWorkItemsTool, {
        ...CONNECTION,
        query: 'login bug',
        projectId: 'project-1',
        limit: 5,
      })
    ).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/work-items/search/?search=login+bug&project_id=project-1&limit=5'
    )
    const result = await planeSearchWorkItemsTool.transformResponse?.(
      jsonResponse({
        issues: [
          {
            name: 'Fix login',
            id: 'item-1',
            sequence_id: 42,
            project__identifier: 'ENG',
            project_id: 'project-1',
            workspace__slug: 'acme',
          },
        ],
      })
    )
    expect(result?.output.results).toEqual([
      {
        id: 'item-1',
        name: 'Fix login',
        sequenceId: 42,
        projectIdentifier: 'ENG',
        identifier: 'ENG-42',
        projectId: 'project-1',
        workspaceSlug: 'acme',
      },
    ])
  })
})

describe('Plane collaboration and planning tools', () => {
  it('posts comment HTML with an upper-cased access level', () => {
    expect(
      planeCreateCommentTool.request.body?.({
        ...SCOPE,
        comment: '<p>Done</p>',
        access: 'external',
      })
    ).toEqual({ comment_html: '<p>Done</p>', access: 'EXTERNAL' })
  })

  it('treats the unpaginated current-cycle response as a single page', async () => {
    const result = await planeListCyclesTool.transformResponse?.(
      jsonResponse([{ id: 'cycle-1', name: 'Sprint 1', total_issues: 3, completed_issues: 1 }])
    )
    expect(result?.output).toMatchObject({
      cycles: [{ id: 'cycle-1', name: 'Sprint 1', totalIssues: 3, completedIssues: 1 }],
      nextCursor: null,
      nextPageResults: false,
      totalResults: 1,
    })
  })

  it('adds work items to a cycle and returns every work item now in it', async () => {
    const params = {
      ...CONNECTION,
      projectId: 'project-1',
      cycleId: 'cycle-1',
      workItemIds: 'item-1,item-2',
    }
    expect(resolveUrl(planeAddWorkItemsToCycleTool, params)).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/projects/project-1/cycles/cycle-1/cycle-issues/'
    )
    expect(planeAddWorkItemsToCycleTool.request.body?.(params)).toEqual({
      issues: ['item-1', 'item-2'],
    })
    const result = await planeAddWorkItemsToCycleTool.transformResponse?.(
      jsonResponse([
        { id: 'ci-1', issue: 'item-1', cycle: 'cycle-1' },
        { id: 'ci-2', issue: 'item-2', cycle: 'cycle-1' },
        { id: 'ci-3', issue: 'item-0', cycle: 'cycle-1' },
      ])
    )
    expect(result?.output.workItemIds).toEqual(['item-1', 'item-2', 'item-0'])
  })

  it('reads project members as user objects', async () => {
    const result = await planeListProjectMembersTool.transformResponse?.(
      jsonResponse([
        { id: 'user-1', display_name: 'ada', email: 'ada@example.com', first_name: 'Ada' },
      ])
    )
    expect(result?.output.members).toEqual([
      {
        id: 'user-1',
        firstName: 'Ada',
        lastName: null,
        displayName: 'ada',
        email: 'ada@example.com',
        avatar: null,
        avatarUrl: null,
      },
    ])
  })

  it('reads the current user without a workspace', () => {
    expect(resolveUrl(planeGetCurrentUserTool, { apiKey: 'k' })).toBe(
      'https://api.plane.so/api/v1/users/me/'
    )
  })
})

describe('Plane download attachment', () => {
  it('requests the binary attachment and names the file from the signed response', async () => {
    const params = { ...SCOPE, attachmentId: 'asset-1' }
    expect(planeDownloadAttachmentTool.request.responseType).toBe('binary')
    expect(resolveUrl(planeDownloadAttachmentTool, params)).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/projects/project-1/work-items/item-1/attachments/asset-1/'
    )
    const result = await planeDownloadAttachmentTool.transformResponse?.(
      new Response('hello', {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': "attachment; filename*=UTF-8''hello.txt",
        },
      }),
      params
    )
    expect(result?.output.file).toMatchObject({
      name: 'hello.txt',
      mimeType: 'text/plain',
      size: 5,
    })
    expect(Buffer.isBuffer(result?.output.file.data)).toBe(true)
  })
})
