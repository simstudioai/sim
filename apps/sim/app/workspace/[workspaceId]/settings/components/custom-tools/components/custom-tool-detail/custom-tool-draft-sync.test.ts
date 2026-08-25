import { describe, expect, it } from 'vitest'
import { customToolSourceChanged } from './custom-tool-draft-sync'

const source = { id: 'tool-1', schema: '{"name":"echo"}', code: 'return value' }

describe('Custom Tool draft synchronization', () => {
  it('detects server-side schema and code updates', () => {
    expect(customToolSourceChanged(source, source)).toBe(false)
    expect(customToolSourceChanged(source, { ...source, code: 'return value.trim()' })).toBe(true)
    expect(customToolSourceChanged(source, { ...source, schema: '{"name":"format"}' })).toBe(true)
  })

  it('detects switching to another tool with identical content', () => {
    expect(customToolSourceChanged(source, { ...source, id: 'tool-2' })).toBe(true)
  })
})
