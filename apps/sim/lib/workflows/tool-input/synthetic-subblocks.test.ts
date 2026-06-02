/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildToolSubBlockId,
  isSyntheticToolSubBlockId,
  resolveToolParamSync,
} from '@/lib/workflows/tool-input/synthetic-subblocks'

describe('buildToolSubBlockId', () => {
  it('composes the synthetic id from aggregate id, tool index, and param id', () => {
    expect(buildToolSubBlockId('tools', 0, 'knowledgeBaseSelector')).toBe(
      'tools-tool-0-knowledgeBaseSelector'
    )
    expect(buildToolSubBlockId('tools', 3, 'credential')).toBe('tools-tool-3-credential')
  })

  it('produces ids recognized by isSyntheticToolSubBlockId', () => {
    expect(isSyntheticToolSubBlockId(buildToolSubBlockId('tools', 0, 'file'))).toBe(true)
    expect(isSyntheticToolSubBlockId(buildToolSubBlockId('tools', 12, 'documentTags'))).toBe(true)
  })
})

describe('isSyntheticToolSubBlockId', () => {
  it('returns false for real subblock ids', () => {
    expect(isSyntheticToolSubBlockId('tools')).toBe(false)
    expect(isSyntheticToolSubBlockId('model')).toBe(false)
    expect(isSyntheticToolSubBlockId('knowledgeBaseSelector')).toBe(false)
    expect(isSyntheticToolSubBlockId('tools-credential')).toBe(false)
  })
})

describe('resolveToolParamSync', () => {
  it('re-projects a removed key instead of clearing params', () => {
    expect(resolveToolParamSync(undefined, 'kb-123')).toEqual({ action: 'reproject' })
  })

  it('mirrors a user clear as an empty string', () => {
    expect(resolveToolParamSync('', 'kb-123')).toEqual({ action: 'mirror', value: '' })
    expect(resolveToolParamSync(null, 'kb-123')).toEqual({ action: 'mirror', value: '' })
  })

  it('mirrors a changed value', () => {
    expect(resolveToolParamSync('kb-456', 'kb-123')).toEqual({ action: 'mirror', value: 'kb-456' })
  })

  it('is a noop when the value already matches the synced value', () => {
    expect(resolveToolParamSync('kb-123', 'kb-123')).toEqual({ action: 'noop' })
  })

  it('stringifies object values for object-typed params', () => {
    expect(resolveToolParamSync({ name: 'a.pdf' }, '{"name":"a.pdf"}')).toEqual({ action: 'noop' })
    expect(resolveToolParamSync({ name: 'b.pdf' }, '{"name":"a.pdf"}')).toEqual({
      action: 'mirror',
      value: '{"name":"b.pdf"}',
    })
  })
})
