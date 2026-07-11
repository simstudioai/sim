/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { jupyterCopyContentTool } from '@/tools/jupyter/copy_content'
import { jupyterCreateFileTool } from '@/tools/jupyter/create_file'
import { jupyterGetContentTool } from '@/tools/jupyter/get_content'
import { jupyterListContentsTool } from '@/tools/jupyter/list_contents'
import { jupyterRenameContentTool } from '@/tools/jupyter/rename_content'

const AUTH = {
  serverUrl: 'http://localhost:8888',
  token: 'token',
}

const CONTENT_MODEL = {
  name: 'notes.txt',
  path: 'docs/notes.txt',
  type: 'file',
  writable: true,
  created: '2026-07-09T10:00:00Z',
  last_modified: '2026-07-09T11:00:00Z',
  size: 5,
  mimetype: 'text/plain',
  format: 'text',
  content: 'hello',
}

describe('Jupyter content transforms', () => {
  it('preserves existing output shapes for valid Contents API models', async () => {
    await expect(
      jupyterCreateFileTool.transformResponse?.(Response.json(CONTENT_MODEL), {
        ...AUTH,
        path: CONTENT_MODEL.path,
        type: 'file',
      })
    ).resolves.toMatchObject({
      success: true,
      output: {
        name: CONTENT_MODEL.name,
        path: CONTENT_MODEL.path,
        type: 'file',
        createdAt: CONTENT_MODEL.created,
        lastModified: CONTENT_MODEL.last_modified,
      },
    })

    await expect(
      jupyterCopyContentTool.transformResponse?.(Response.json(CONTENT_MODEL), {
        ...AUTH,
        path: CONTENT_MODEL.path,
        copyFromPath: 'notes.txt',
      })
    ).resolves.toMatchObject({
      success: true,
      output: {
        name: CONTENT_MODEL.name,
        path: CONTENT_MODEL.path,
        createdAt: CONTENT_MODEL.created,
      },
    })

    await expect(
      jupyterRenameContentTool.transformResponse?.(Response.json(CONTENT_MODEL), {
        ...AUTH,
        path: 'notes.txt',
        newPath: CONTENT_MODEL.path,
      })
    ).resolves.toMatchObject({
      success: true,
      output: {
        name: CONTENT_MODEL.name,
        path: CONTENT_MODEL.path,
        lastModified: CONTENT_MODEL.last_modified,
      },
    })

    await expect(
      jupyterListContentsTool.transformResponse?.(
        Response.json({ ...CONTENT_MODEL, path: 'docs', content: [CONTENT_MODEL] }),
        { ...AUTH, path: 'docs' }
      )
    ).resolves.toMatchObject({
      success: true,
      output: {
        path: 'docs',
        items: [
          {
            name: CONTENT_MODEL.name,
            path: CONTENT_MODEL.path,
            type: 'file',
            writable: true,
            created: CONTENT_MODEL.created,
            lastModified: CONTENT_MODEL.last_modified,
            size: CONTENT_MODEL.size,
            mimetype: CONTENT_MODEL.mimetype,
            format: CONTENT_MODEL.format,
          },
        ],
      },
    })

    await expect(
      jupyterGetContentTool.transformResponse?.(Response.json(CONTENT_MODEL), {
        ...AUTH,
        path: CONTENT_MODEL.path,
      })
    ).resolves.toMatchObject({
      success: true,
      output: {
        name: CONTENT_MODEL.name,
        path: CONTENT_MODEL.path,
        mimetype: CONTENT_MODEL.mimetype,
        text: CONTENT_MODEL.content,
        file: null,
      },
    })
  })
})
