/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { copilotToolCanWrite, copilotWriteDeniedMessage } from '@/lib/copilot/tools/permissions'

describe('copilotToolCanWrite', () => {
  it('fails closed when the permission is absent', () => {
    expect(copilotToolCanWrite(undefined)).toBe(false)
    expect(copilotToolCanWrite(null)).toBe(false)
    expect(copilotToolCanWrite('')).toBe(false)
  })

  it('denies read-only and unrecognized permissions', () => {
    expect(copilotToolCanWrite('read')).toBe(false)
    expect(copilotToolCanWrite('nonsense')).toBe(false)
  })

  it('allows write and admin', () => {
    expect(copilotToolCanWrite('write')).toBe(true)
    expect(copilotToolCanWrite('admin')).toBe(true)
  })
})

describe('copilotWriteDeniedMessage', () => {
  it('names the operation and the caller’s actual permission', () => {
    expect(copilotWriteDeniedMessage('manage_custom_tool', 'delete', 'read')).toBe(
      "Permission denied: 'delete' on manage_custom_tool requires write access. You have 'read' permission."
    )
  })

  it('reports "none" rather than an empty string when permission is absent', () => {
    expect(copilotWriteDeniedMessage('manage_skill', 'add', undefined)).toContain("You have 'none'")
  })

  it('omits the operation label when there is no operation', () => {
    expect(copilotWriteDeniedMessage('manage_knowledge_base', undefined, 'read')).toBe(
      "Permission denied: manage_knowledge_base requires write access. You have 'read' permission."
    )
  })
})
