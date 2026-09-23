/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getHiddenToolNames, isToolHiddenInUi } from './hidden-tools'

describe('isToolHiddenInUi', () => {
  it('hides the internal loaders', () => {
    expect(isToolHiddenInUi('load_custom_tool')).toBe(true)
    expect(isToolHiddenInUi('load_integration_tool')).toBe(true)
    // Retained for historical persisted messages even though it is no longer emitted.
    expect(isToolHiddenInUi('load_agent_skill')).toBe(true)
  })

  it('does not hide ordinary tools or undefined', () => {
    expect(isToolHiddenInUi('read')).toBe(false)
    expect(isToolHiddenInUi(undefined)).toBe(false)
  })

  it('exposes the hidden set', () => {
    expect(getHiddenToolNames().has('load_custom_tool')).toBe(true)
  })
})
