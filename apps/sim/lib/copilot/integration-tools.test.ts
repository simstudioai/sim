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
    // paradigm) — must not become the owner of the shared tools.
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

describe('getExposedIntegrationTools', () => {
  beforeEach(() => {
    resetExposedIntegrationToolsCache()
  })

  it('keeps the released block as owner of tools a preview block shares', () => {
    const send = getExposedIntegrationTools().find((t) => t.toolId === 'svc_send_v2')
    expect(send).toBeDefined()
    expect(send?.blockType).toBe('svc')
    expect(send?.preview).toBeFalsy()
  })

  it('exposes shared tools to viewers without the preview reveal, but not preview-only tools', () => {
    const visible = filterExposedIntegrationTools(getExposedIntegrationTools(), null)
    expect(visible.some((t) => t.toolId === 'svc_send_v2')).toBe(true)
    expect(visible.some((t) => t.toolId === 'newsvc_do_v1')).toBe(false)
  })

  it('exposes only the latest version of each tool', () => {
    const exposed = getExposedIntegrationTools()
    expect(exposed.some((t) => t.toolId === 'svc_send_v1')).toBe(false)
    expect(exposed.some((t) => t.toolId === 'svc_send_v2')).toBe(true)
  })
})
