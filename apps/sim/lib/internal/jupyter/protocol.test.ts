/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertSafeJupyterProxyPath,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
  parseJupyterContentModel,
  UnsafeJupyterPathError,
} from '@/lib/internal/jupyter/protocol'

describe('Jupyter protocol', () => {
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

  it('preserves base paths while normalizing server URLs', () => {
    expect(normalizeJupyterServerUrl('jupyter.internal:8888/base/')).toBe(
      'http://jupyter.internal:8888/base'
    )
  })

  it('encodes contents paths without encoding their separators', () => {
    expect(encodeJupyterPath('folder name/analysis #1.ipynb')).toBe(
      'folder%20name/analysis%20%231.ipynb'
    )
  })

  it('rejects literal and encoded traversal in proxy paths', () => {
    expect(() => assertSafeJupyterProxyPath('contents/a/../secret')).toThrow(UnsafeJupyterPathError)
    expect(() => assertSafeJupyterProxyPath('contents/a%2f..%2fsecret?content=1')).toThrow(
      UnsafeJupyterPathError
    )
  })
})
