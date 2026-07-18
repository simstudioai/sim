import { describe, expect, it } from 'vitest'
import { FULLSTACK_TOOL_NAMES } from '@/lib/apps/agent/fullstack-contract'
import {
  appPreparePublishServerTool,
  fullstackAppServerTools,
} from '@/lib/apps/agent/fullstack-tools'

describe('Full-stack App server tools', () => {
  it('implements every locked tool name exactly once', () => {
    const names = fullstackAppServerTools.map((tool) => tool.name)
    expect(names).toEqual(FULLSTACK_TOOL_NAMES)
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares server-side input validation for every handler', () => {
    for (const tool of fullstackAppServerTools) {
      expect(tool.inputSchema, `${tool.name} input schema`).toBeDefined()
    }
  })

  it('prepares without publishing unless confirmation is explicit', () => {
    expect(appPreparePublishServerTool.inputSchema?.parse({ projectId: 'project-1' })).toEqual({
      projectId: 'project-1',
      publish: false,
    })
  })
})
