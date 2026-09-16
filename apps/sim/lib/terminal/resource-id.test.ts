/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { terminalIdFromResourceId, terminalResourceId } from '@/lib/terminal/resource-id'

describe('terminal resource ids', () => {
  it('keeps a shell apart from a browser page with the same native id', () => {
    expect(terminalResourceId('1')).not.toBe('1')
    expect(terminalIdFromResourceId(terminalResourceId('1'))).toBe('1')
  })
})
