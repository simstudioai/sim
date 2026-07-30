/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseJupyterContentModel } from '@/tools/jupyter/utils'

describe('parseJupyterContentModel', () => {
  it('normalizes a Jupyter Contents API model without changing its values', () => {
    const content = { cells: [] }

    expect(
      parseJupyterContentModel({
        name: 'analysis.ipynb',
        path: 'notebooks/analysis.ipynb',
        type: 'notebook',
        writable: true,
        created: '2026-07-09T10:00:00Z',
        last_modified: '2026-07-09T11:00:00Z',
        size: 42,
        mimetype: 'application/x-ipynb+json',
        format: 'json',
        content,
      })
    ).toEqual({
      name: 'analysis.ipynb',
      path: 'notebooks/analysis.ipynb',
      type: 'notebook',
      writable: true,
      created: '2026-07-09T10:00:00Z',
      lastModified: '2026-07-09T11:00:00Z',
      size: 42,
      mimetype: 'application/x-ipynb+json',
      format: 'json',
      content,
    })
  })

  it('rejects non-object models and omits fields with invalid types', () => {
    expect(parseJupyterContentModel(null)).toBeNull()
    expect(
      parseJupyterContentModel({
        name: 42,
        path: 'valid/path',
        size: '42',
        content: null,
      })
    ).toEqual({
      path: 'valid/path',
      content: null,
    })
  })
})
