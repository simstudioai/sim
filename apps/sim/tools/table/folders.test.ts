/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  tableCreateFolderSchemas,
  tableDeleteFolderSchemas,
  tableListFoldersSchemas,
  tableMoveSchemas,
  tableRestoreFolderSchemas,
  tableUpdateFolderSchemas,
} from '@/lib/api/contracts/tools/table'
import {
  tableCreateFolderTool,
  tableDeleteFolderTool,
  tableListFoldersTool,
  tableMoveTool,
  tableRestoreFolderTool,
  tableUpdateFolderTool,
} from '@/tools/table/folders'
import type { InternalToolConfig } from '@/tools/types'

/*
 * The seam between what a tool sends and what the dispatcher accepts. Each side
 * type-checks alone, so a field renamed on one of them is invisible until a run
 * fails — these assert the tool's own `operation.input` satisfies the schema its
 * id is dispatched against.
 */
function inputOf(tool: InternalToolConfig, params: Record<string, unknown>) {
  return tool.operation.input?.(params as never)
}

describe('table folder tools emit input their schemas accept', () => {
  it.each([
    [
      tableListFoldersTool,
      tableListFoldersSchemas,
      { path: '/Reports', recursive: true, depth: 2 },
    ],
    [tableCreateFolderTool, tableCreateFolderSchemas, { path: '/Reports/Q3' }],
    [
      tableUpdateFolderTool,
      tableUpdateFolderSchemas,
      { path: '/Reports/Q3', destinationPath: '/Archive/Q3' },
    ],
    [tableDeleteFolderTool, tableDeleteFolderSchemas, { path: '/Reports', recursive: true }],
    [tableRestoreFolderTool, tableRestoreFolderSchemas, { path: '/Reports/Q3' }],
    [tableMoveTool, tableMoveSchemas, { tableId: 'table-1', folderPath: '/Reports' }],
  ] as const)('$1.id', (tool, schemas, params) => {
    const parsed = schemas.body.safeParse(inputOf(tool, params))
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('drops a blank optional path rather than sending an empty string', () => {
    const input = inputOf(tableListFoldersTool, { path: '  ', search: '' })

    expect(input).toMatchObject({ path: undefined, search: undefined })
    expect(tableListFoldersSchemas.body.safeParse(input).success).toBe(true)
  })

  it('sends an unset move destination as the workspace root, not as omitted', () => {
    /*
     * The update use case reads an omitted folderPath as "leave the folder
     * alone", so dropping it would turn "move this to the root" into a no-op
     * that still reported success.
     */
    expect(inputOf(tableMoveTool, { tableId: 'table-1' })).toMatchObject({ folderPath: '/' })
    expect(inputOf(tableMoveTool, { tableId: 'table-1', folderPath: '' })).toMatchObject({
      folderPath: '/',
    })
  })

  it('sends no workspace, because the executor principal is the only authority on it', () => {
    for (const tool of [
      tableListFoldersTool,
      tableCreateFolderTool,
      tableDeleteFolderTool,
      tableMoveTool,
    ]) {
      expect(inputOf(tool, { path: '/Reports', tableId: 'table-1' })).not.toHaveProperty(
        'workspaceId'
      )
    }
  })
})

describe('table folder tool parameter policy', () => {
  it('keeps the delete cascade out of a model’s reach', () => {
    /*
     * A model asked to "clean up" a folder will set this on a guess, and it
     * takes every nested folder and table with it.
     */
    expect(tableDeleteFolderTool.params.recursive.visibility).toBe('user-only')
    expect(tableDeleteFolderTool.params.recursive.required).toBe(false)
  })

  it('tells the model what a folder path looks like on every path parameter', () => {
    const pathParams = [
      tableListFoldersTool.params.path,
      tableCreateFolderTool.params.path,
      tableUpdateFolderTool.params.path,
      tableUpdateFolderTool.params.destinationPath,
      tableDeleteFolderTool.params.path,
      tableRestoreFolderTool.params.path,
      tableMoveTool.params.folderPath,
    ]

    for (const param of pathParams) {
      expect(param.description).toContain('percent-encoded')
    }
  })
})

/*
 * The shared response transform is the ONLY error surface these six tools
 * present to a model. A typo here turns every folder failure into a success
 * carrying `undefined`, which is worse than the failure - so both arms and the
 * success projection are pinned.
 */
describe('table folder tools surface failures rather than swallowing them', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('projects the operation payload on success', async () => {
    const result = await tableCreateFolderTool.transformResponse?.(
      jsonResponse({ success: true, data: { folder: { name: 'Q3' } } })
    )

    expect(result).toEqual({ success: true, output: { folder: { name: 'Q3' } } })
  })

  it('carries the server error message through instead of reporting success', async () => {
    const result = await tableDeleteFolderTool.transformResponse?.(
      jsonResponse({ error: 'Folder is not empty' }, 409)
    )

    expect(result).toMatchObject({ success: false, error: 'Folder is not empty' })
  })

  it('reads a 200 that is not a success as a failure', async () => {
    /* `success: false` in a 200 body is still a failure, not an empty output. */
    const result = await tableMoveTool.transformResponse?.(jsonResponse({ success: false }))

    expect(result).toMatchObject({ success: false })
    expect(result?.error).toBeTruthy()
  })

  it.each([
    [tableListFoldersTool, 'Failed to list table folders'],
    [tableCreateFolderTool, 'Failed to create table folder'],
    [tableUpdateFolderTool, 'Failed to move table folder'],
    [tableDeleteFolderTool, 'Failed to delete table folder'],
    [tableRestoreFolderTool, 'Failed to restore table folder'],
    [tableMoveTool, 'Failed to move table'],
  ] as const)('names the operation when the server sends no message', async (tool, fallback) => {
    const result = await tool.transformResponse?.(jsonResponse({}, 500))

    expect(result).toMatchObject({ success: false, error: fallback })
  })
})
