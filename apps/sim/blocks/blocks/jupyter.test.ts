import { describe, expect, it } from 'vitest'
import { JupyterBlock } from '@/blocks/blocks/jupyter'

const SERVER = { serverUrl: 'https://jupyter.example.com', token: 'token' }

/** The executor sends `{ ...storedInputs, ...mapped }`, so a value stored for another operation must not leak in. */
describe('Jupyter block Create Session', () => {
  it('does not send the Create File type as the session type', () => {
    const stored = {
      ...SERVER,
      operation: 'jupyter_create_session',
      path: 'analysis.ipynb',
      type: 'file',
    }
    expect(
      { ...stored, ...JupyterBlock.tools.config.params(stored, undefined) }.type
    ).toBeUndefined()
  })

  it('sends the Session Type field, or the model type on an agent tool call', () => {
    const stored = { ...SERVER, operation: 'jupyter_create_session', sessionType: 'console' }
    expect(JupyterBlock.tools.config.params(stored, undefined).type).toBe('console')
    expect(
      JupyterBlock.tools.config.params(
        { ...SERVER, path: 'a.ipynb', type: 'console' },
        { operation: 'jupyter_create_session' }
      ).type
    ).toBe('console')
  })
})
