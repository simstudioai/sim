/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  knowledgeCreateFolderBodySchema,
  knowledgeDeleteFolderBodySchema,
  knowledgeListFoldersBodySchema,
  knowledgeUpdateFolderBodySchema,
} from '@/lib/api/contracts/knowledge/folders'
import {
  knowledgeCreateFolderTool,
  knowledgeDeleteFolderTool,
  knowledgeListFoldersTool,
  knowledgeUpdateFolderTool,
} from '@/tools/knowledge/folders'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

/**
 * The tool input transformer is the last thing to touch a value before the
 * in-process dispatch validates it, so what it emits is asserted against the
 * same schemas the dispatch parses with.
 */
function inputFor(tool: InternalToolConfig<any, ToolResponse>, params: Record<string, unknown>) {
  return tool.operation.input?.(params as never) as Record<string, unknown>
}

function responseOf(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response
}

describe('knowledge folder tools normalize their input', () => {
  it('drops a blank optional path and search rather than forwarding an empty string', () => {
    const input = inputFor(knowledgeListFoldersTool, { path: '   ', search: '' })

    expect(input.path).toBeUndefined()
    expect(input.search).toBeUndefined()
    expect(knowledgeListFoldersBodySchema.safeParse(input).success).toBe(true)
  })

  it('forwards the whole listing shape, trimming the path', () => {
    const input = inputFor(knowledgeListFoldersTool, {
      path: '  /Reports  ',
      recursive: true,
      depth: 3,
      search: '  q3  ',
      limit: 50,
    })

    expect(input).toEqual({
      path: '/Reports',
      recursive: true,
      depth: 3,
      search: 'q3',
      limit: 50,
    })
    expect(knowledgeListFoldersBodySchema.safeParse(input).success).toBe(true)
  })

  it('carries a create path and a move, leaving a blank one absent', () => {
    expect(inputFor(knowledgeCreateFolderTool, { path: '  ' }).path).toBeUndefined()
    expect(
      knowledgeCreateFolderBodySchema.safeParse(inputFor(knowledgeCreateFolderTool, { path: '' }))
        .success
    ).toBe(false)
    expect(
      knowledgeCreateFolderBodySchema.safeParse(
        inputFor(knowledgeCreateFolderTool, { path: ' /Reports/Q3 ' })
      ).success
    ).toBe(true)
    const move = inputFor(knowledgeUpdateFolderTool, {
      path: ' /Reports/Q3 ',
      destinationPath: ' /Archive/Q3 ',
    })

    expect(move).toEqual({ path: '/Reports/Q3', destinationPath: '/Archive/Q3' })
    expect(knowledgeUpdateFolderBodySchema.safeParse(move).success).toBe(true)
  })

  it('carries the delete guard exactly as set, including off', () => {
    expect(inputFor(knowledgeDeleteFolderTool, { path: '/Reports', recursive: true })).toEqual({
      path: '/Reports',
      recursive: true,
    })
    const off = inputFor(knowledgeDeleteFolderTool, { path: '/Reports' })
    expect(off.recursive).toBeUndefined()
    expect(knowledgeDeleteFolderBodySchema.safeParse(off).success).toBe(true)
    /*
     * A recursive delete takes every nested folder and knowledge base with it,
     * so a model must not be able to set it - only a human configuring the
     * block.
     */
    expect(knowledgeDeleteFolderTool.params.recursive.visibility).toBe('user-only')
    expect(knowledgeListFoldersTool.params.recursive.visibility).toBe('user-or-llm')
  })
})

describe('knowledge folder tools project their response', () => {
  it('unwraps the data envelope on success', async () => {
    const result = await knowledgeListFoldersTool.transformResponse!(
      responseOf({ success: true, data: { path: '/', entries: [], truncated: false } }),
      {} as never
    )

    expect(result).toEqual({
      success: true,
      output: { path: '/', entries: [], truncated: false },
    })
  })

  it('reports the server error text when the request failed', async () => {
    const result = await knowledgeCreateFolderTool.transformResponse!(
      responseOf({ success: false, error: 'Folder already exists' }, false),
      {} as never
    )

    expect(result).toEqual({
      success: false,
      output: {},
      error: 'Folder already exists',
    })
  })

  /*
   * A 200 carrying `success: false` is still a failure - reading only the HTTP
   * status would report an error body as the tool's output.
   */
  it('treats an unsuccessful body as a failure even on a 200', async () => {
    const result = await knowledgeDeleteFolderTool.transformResponse!(
      responseOf({ success: false }),
      {} as never
    )

    expect(result).toEqual({
      success: false,
      output: {},
      error: 'Failed to delete knowledge folder',
    })
  })

  it('falls back to a per-tool message when the server named no error', async () => {
    const messages = await Promise.all(
      [
        knowledgeListFoldersTool,
        knowledgeCreateFolderTool,
        knowledgeUpdateFolderTool,
        knowledgeDeleteFolderTool,
      ].map(async (tool) => {
        const result = await tool.transformResponse!(responseOf({}, false), {} as never)
        return result.error
      })
    )

    expect(messages).toEqual([
      'Failed to list knowledge folder contents',
      'Failed to create knowledge folder',
      'Failed to move knowledge folder',
      'Failed to delete knowledge folder',
    ])
  })
})
