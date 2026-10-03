import {
  CURRENT_BROWSER_TOOL_NAMES,
  isBrowserToolName,
  isCurrentBrowserToolName,
} from '@sim/browser-protocol'
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/mothership/generated/tool-catalog-v1'

const BROWSER_RESULT_SCHEMA_BASELINE = { covered: 13, total: 23 } as const

describe('browser tool protocol contract', () => {
  it('matches the current model-visible browser catalog after legacy exclusions', () => {
    const protocolTools = [...CURRENT_BROWSER_TOOL_NAMES].sort()
    const catalogTools = Object.keys(TOOL_CATALOG)
      .filter((name) => name.startsWith('browser_'))
      .sort()

    expect(protocolTools).toEqual(catalogTools)
  })

  it('keeps every current browser tool on the client execution boundary', () => {
    for (const toolName of CURRENT_BROWSER_TOOL_NAMES) {
      expect(TOOL_CATALOG[toolName]).toMatchObject({
        id: toolName,
        name: toolName,
        route: 'client',
        clientExecutable: true,
      })
    }
  })

  it('does not regress canonical browser result-schema coverage', () => {
    const schemaCount = CURRENT_BROWSER_TOOL_NAMES.filter(
      (toolName) => TOOL_CATALOG[toolName]?.resultSchema !== undefined
    ).length

    expect(schemaCount).toBeGreaterThanOrEqual(BROWSER_RESULT_SCHEMA_BASELINE.covered)
    expect(schemaCount * BROWSER_RESULT_SCHEMA_BASELINE.total).toBeGreaterThanOrEqual(
      BROWSER_RESULT_SCHEMA_BASELINE.covered * CURRENT_BROWSER_TOOL_NAMES.length
    )
  })

  it('recognizes retired browser history without treating it as executable', () => {
    expect(isBrowserToolName('browser_request_takeover')).toBe(true)
    expect(isCurrentBrowserToolName('browser_request_takeover')).toBe(false)
  })
})
