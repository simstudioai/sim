import { describe, expect, it } from 'vitest'
import { temporalScheduleUrl, temporalWorkflowUrl } from '@/tools/temporal/utils'

describe('Temporal URL builders', () => {
  it.each(['..', '.', ' .. '])('rejects the dot segment %j instead of popping the path', (id) => {
    expect(() => temporalWorkflowUrl('https://t.example.com', 'default', id)).toThrow(
      'path traversal'
    )
    expect(() => temporalScheduleUrl('https://t.example.com', 'default', id)).toThrow(
      'path traversal'
    )
    expect(() => temporalWorkflowUrl('https://t.example.com', id, 'wf')).toThrow('path traversal')
  })

  it('keeps encoding workflow IDs that contain a slash', () => {
    expect(temporalWorkflowUrl('https://t.example.com/', 'default', ' order/42 ')).toBe(
      'https://t.example.com/api/v1/namespaces/default/workflows/order%2F42'
    )
  })
})
