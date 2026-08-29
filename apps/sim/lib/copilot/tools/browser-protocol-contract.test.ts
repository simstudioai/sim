import {
  CURRENT_BROWSER_TOOL_NAMES,
  isBrowserToolName,
  isCurrentBrowserToolName,
} from '@sim/browser-protocol'
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'

describe('browser tool protocol contract', () => {
  it('matches the current model-visible browser catalog after legacy exclusions', () => {
    const protocolTools = [...CURRENT_BROWSER_TOOL_NAMES].sort()
    const catalogTools = Object.keys(TOOL_CATALOG)
      .filter((name) => name.startsWith('browser_'))
      .sort()

    expect(protocolTools).toEqual(catalogTools)
  })

  it('recognizes retired browser history without treating it as executable', () => {
    expect(isBrowserToolName('browser_request_takeover')).toBe(true)
    expect(isCurrentBrowserToolName('browser_request_takeover')).toBe(false)
  })
})
