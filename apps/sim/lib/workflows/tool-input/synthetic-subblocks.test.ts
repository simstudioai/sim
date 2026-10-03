import { describe, expect, it } from 'vitest'
import { resolveToolParamSync } from '@/lib/workflows/tool-input/synthetic-subblocks'

describe('resolveToolParamSync', () => {
  it('re-projects a removed key instead of clearing params', () => {
    expect(resolveToolParamSync(undefined, 'kb-123')).toEqual({ action: 'reproject' })
  })

  it('mirrors a user clear as an empty string', () => {
    expect(resolveToolParamSync('', 'kb-123')).toEqual({ action: 'mirror', value: '' })
    expect(resolveToolParamSync(null, 'kb-123')).toEqual({ action: 'mirror', value: '' })
  })

  it('stringifies object values for object-typed params', () => {
    expect(resolveToolParamSync({ name: 'a.pdf' }, '{"name":"a.pdf"}')).toEqual({ action: 'noop' })
    expect(resolveToolParamSync({ name: 'b.pdf' }, '{"name":"a.pdf"}')).toEqual({
      action: 'mirror',
      value: '{"name":"b.pdf"}',
    })
  })
})
