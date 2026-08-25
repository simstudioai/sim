/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks/registry-maps', () => ({
  BLOCK_REGISTRY: {
    svc: {
      type: 'svc',
      tools: { access: ['svc_send_v2'] },
    },
    // Preview successor sharing the released block's tools (the slack/slack_v2
    // paradigm) — both owners must remain available for projection.
    svc_v2: {
      type: 'svc_v2',
      preview: true,
      tools: { access: ['svc_send_v2'] },
    },
    // Preview block with tools of its own — stays preview-owned and gated.
    newsvc: {
      type: 'newsvc',
      preview: true,
      tools: { access: ['newsvc_do_v1'] },
    },
  },
}))

vi.mock('@/tools/registry', () => ({
  tools: {
    svc_send_v1: { name: 'Send (legacy)' },
    svc_send_v2: { name: 'Send' },
    newsvc_do_v1: { name: 'Do' },
  },
}))

import {
  filterExposedIntegrationTools,
  getExposedIntegrationTools,
  resetExposedIntegrationToolsCache,
} from '@/lib/copilot/integration-tools'

const allowAllOwners = () => true
const allowAllTools = () => true

describe('getExposedIntegrationTools', () => {
  beforeEach(() => {
    resetExposedIntegrationToolsCache()
  })

  it('keeps the released block as owner of tools a preview block shares', () => {
    const send = getExposedIntegrationTools().find((t) => t.toolId === 'svc_send_v2')
    expect(send).toBeDefined()
    expect(send?.blockType).toBe('svc')
    expect(send?.preview).toBeFalsy()
    expect(send?.owners.map((owner) => owner.blockType)).toEqual(['svc', 'svc_v2'])
  })

  it('exposes shared tools to viewers without the preview reveal, but not preview-only tools', () => {
    const visible = filterExposedIntegrationTools(
      getExposedIntegrationTools(),
      null,
      allowAllOwners,
      allowAllTools
    )
    expect(visible.some((t) => t.toolId === 'svc_send_v2')).toBe(true)
    expect(visible.some((t) => t.toolId === 'newsvc_do_v1')).toBe(false)
  })

  it('uses a revealed preview owner when the released owner is unavailable', () => {
    const vis = {
      revealed: new Set(['svc_v2']),
      disabled: new Set<string>(),
      previewTagged: new Set(['svc_v2']),
    }
    const visible = filterExposedIntegrationTools(
      getExposedIntegrationTools(),
      vis,
      (owner) => owner.blockType !== 'svc',
      allowAllTools
    )
    const send = visible.find((tool) => tool.toolId === 'svc_send_v2')

    expect(send?.blockType).toBe('svc_v2')
    expect(send?.preview).toBe(true)
  })

  it("drops a tool the viewer's permission group denies outright", () => {
    const visible = filterExposedIntegrationTools(
      getExposedIntegrationTools(),
      null,
      allowAllOwners,
      (toolId) => toolId !== 'svc_send_v2'
    )

    expect(visible.some((t) => t.toolId === 'svc_send_v2')).toBe(false)
  })

  it('exposes only the latest version of each tool', () => {
    const exposed = getExposedIntegrationTools()
    expect(exposed.some((t) => t.toolId === 'svc_send_v1')).toBe(false)
    expect(exposed.some((t) => t.toolId === 'svc_send_v2')).toBe(true)
  })
})
