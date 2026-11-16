/**
 * Workflow runs hand a tool `{ ...rawInputs, ...mappedParams }`, so the mapper must clear values
 * another operation left in a shared subBlock. Agent tool calls pass the operation in context and
 * supply arguments under the tool's param names, which the mapper must keep.
 */
import { describe, expect, it } from 'vitest'
import { DubBlock } from '@/blocks/blocks/dub'
import { createLinkTool } from '@/tools/dub/create_link'
import { getAnalyticsTool } from '@/tools/dub/get_analytics'
import type { ToolConfig } from '@/tools/types'

function workflowParams(inputs: Record<string, unknown>): Record<string, unknown> {
  return { ...inputs, ...(DubBlock.tools.config.params?.(inputs) ?? {}) }
}

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, ...(DubBlock.tools.config.params?.(args, { operation }) ?? {}) }
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): URL {
  const url = tool.request.url
  return new URL(typeof url === 'function' ? url(params) : url)
}

function requestBody(tool: ToolConfig, params: Record<string, unknown>) {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no request body`)
  return body(params)
}

describe('Dub block parameter mapping', () => {
  it('keeps the destination, slug, and conversion flag an agent passes to Create Link', () => {
    const params = agentParams('create_link', {
      apiKey: 'dub_test',
      url: 'https://sim.ai',
      domain: 'go.sim.ai',
      key: 'launch',
      trackConversion: true,
    })
    expect(requestBody(createLinkTool, params)).toEqual({
      url: 'https://sim.ai',
      domain: 'go.sim.ai',
      key: 'launch',
      trackConversion: true,
    })
  })

  it('keeps the link and domain filters an agent passes to Get Analytics', () => {
    const url = requestUrl(
      getAnalyticsTool,
      agentParams('get_analytics', { apiKey: 'dub_test', linkId: 'link_1', domain: 'go.sim.ai' })
    )
    expect(url.searchParams.get('linkId')).toBe('link_1')
    expect(url.searchParams.get('domain')).toBe('go.sim.ai')
  })

  it('drops a create-link domain left behind when a workflow switches to Get Analytics', () => {
    const url = requestUrl(
      getAnalyticsTool,
      workflowParams({ operation: 'get_analytics', apiKey: 'dub_test', domain: 'stale.sh' })
    )
    expect(url.searchParams.get('domain')).toBeNull()
  })
})
