import { describe, expect, it } from 'vitest'
import { FULLSTACK_TOOL_NAMES } from '@/lib/apps/agent/fullstack-contract'
import {
  appPreparePublishServerTool,
  fullstackAppServerTools,
} from '@/lib/apps/agent/fullstack-tools'
import {
  AppBindAction,
  AppBuild,
  AppDetachAction,
  AppListCallableReleases,
  AppPreparePublish,
  AppRefreshBinding,
  AppWriteFiles,
} from '@/lib/copilot/generated/tool-catalog-v1'

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

  it('cannot publish from the model-routed server tool', () => {
    expect(appPreparePublishServerTool.inputSchema?.parse({ projectId: 'project-1' })).toEqual({
      projectId: 'project-1',
    })
    expect(() =>
      appPreparePublishServerTool.inputSchema?.parse({
        projectId: 'project-1',
        publish: true,
      })
    ).toThrow()
  })

  it('keeps the generated Go catalog ordered and permission-aligned with Sim', () => {
    const catalog = [
      AppBindAction,
      AppRefreshBinding,
      AppDetachAction,
      AppWriteFiles,
      AppBuild,
      AppPreparePublish,
      AppListCallableReleases,
    ]
    expect(catalog.map((tool) => tool.id)).toEqual(FULLSTACK_TOOL_NAMES)
    expect(catalog.map((tool) => tool.requiredPermission)).toEqual([
      'admin',
      'admin',
      'admin',
      'write',
      'write',
      'admin',
      'write',
    ])
  })
})
