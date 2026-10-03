import { describe, expect, it } from 'vitest'
import {
  assertSafeJupyterProxyPath,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
  UnsafeJupyterPathError,
} from '@/lib/internal/jupyter/protocol'

describe('Jupyter protocol', () => {
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
