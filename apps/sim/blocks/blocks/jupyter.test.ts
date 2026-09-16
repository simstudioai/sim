import { describe, expect, it } from 'vitest'
import { JupyterBlock, JupyterV2Block } from '@/blocks/blocks/jupyter'

describe('Jupyter block versions', () => {
  it('offers v2 for new blocks and preserves the legacy block', () => {
    expect(JupyterBlock.hideFromToolbar).toBe(true)
    expect(JupyterBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'jupyter_v2' })
    expect(JupyterV2Block.hideFromToolbar).toBe(false)
    expect(JupyterV2Block.sunset).toBeUndefined()
    expect(JupyterV2Block.canvasPresentation).toBe(JupyterBlock.canvasPresentation)
    expect(JupyterV2Block.subBlocks).toBe(JupyterBlock.subBlocks)
  })

  it.each(JupyterBlock.tools.access)('versions only Get Content: %s', (operation) => {
    const id = operation === 'jupyter_get_content' ? 'jupyter_get_content_v2' : operation
    expect(JupyterBlock.tools.config.tool({ operation })).toBe(operation)
    expect(JupyterV2Block.tools.config?.tool({ operation })).toBe(id)
    expect(JupyterV2Block.tools.access).toContain(id)
  })

  it('preserves the path and credentials for the versioned read', () => {
    expect(
      JupyterV2Block.tools.config?.params?.({
        operation: 'jupyter_get_content',
        serverUrl: 'https://jupyter.example.com',
        token: 'token',
        path: 'reports/book.xlsx',
      })
    ).toEqual({
      serverUrl: 'https://jupyter.example.com',
      token: 'token',
      path: 'reports/book.xlsx',
    })
  })
})
