/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as langsmithTools from '@/tools/langsmith'
import * as launchDarklyTools from '@/tools/launchdarkly'
import { prepareToolRequestUrl } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

/**
 * Tool families whose saved credential carries the region, instance, or host its token belongs
 * to. Every tool must send a run made with such a credential to that host, and a run without one
 * (an inline key in a legacy block) to the host the tools always used.
 */
const FAMILIES: {
  service: string
  tools: Record<string, ToolConfig>
  defaultHost: string
  regions: [domain: string, host: string][]
}[] = [
  {
    service: 'LaunchDarkly',
    tools: launchDarklyTools,
    defaultHost: 'app.launchdarkly.com',
    regions: [
      ['us', 'app.launchdarkly.com'],
      ['eu', 'app.eu.launchdarkly.com'],
      ['federal', 'app.launchdarkly.us'],
    ],
  },
  {
    service: 'LangSmith',
    tools: langsmithTools,
    defaultHost: 'api.smith.langchain.com',
    regions: [
      ['us', 'api.smith.langchain.com'],
      ['eu', 'eu.api.smith.langchain.com'],
      ['apac', 'apac.api.smith.langchain.com'],
      ['aws-us', 'aws.api.smith.langchain.com'],
      ['azure-us', 'azure.api.smith.langchain.com'],
    ],
  },
]

/**
 * A value of each param's type, so every URL builder can run. Hidden params are left unset: only
 * a saved credential fills them.
 */
function placeholderParams(tool: ToolConfig): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(tool.params)
      .filter(([, param]) => param.visibility !== 'hidden')
      .map(([name, param]) => {
        switch (param.type) {
          case 'number':
            return [name, 1]
          case 'boolean':
            return [name, false]
          case 'array':
            return [name, []]
          case 'object':
          case 'json':
            return [name, {}]
          default:
            return [name, name === 'apiKey' ? 'inline-key' : 'x']
        }
      })
  )
}

/** The request host of a run, filling the params a saved credential supplies as the executor does. */
function requestHost(tool: ToolConfig, credential?: Record<string, string>): string {
  const params = placeholderParams(tool)
  if (credential) {
    for (const [param, source] of Object.entries(tool.oauth?.credentialParams ?? {})) {
      params[param] = credential[source]
    }
  }
  return new URL(prepareToolRequestUrl(tool, params)).host
}

const cases = FAMILIES.flatMap(({ service, tools, defaultHost, regions }) =>
  Object.values(tools).map((tool) => ({ service, tool, defaultHost, regions }))
)

describe.each(cases)('$tool.id', ({ tool, defaultHost, regions }) => {
  it.each(regions)('sends a run with a saved %s credential to %s', (domain, host) => {
    expect(requestHost(tool, { accessToken: 'saved-token', domain })).toBe(host)
  })

  it(`keeps a run without a saved credential on ${defaultHost}`, () => {
    expect(requestHost(tool)).toBe(defaultHost)
  })

  it('refuses a region it does not know instead of guessing a host', () => {
    expect(() =>
      requestHost(tool, { accessToken: 'saved-token', domain: 'evil.example.com' })
    ).toThrow()
  })
})
