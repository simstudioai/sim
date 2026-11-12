/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as hexTools from '@/tools/hex'
import * as langsmithTools from '@/tools/langsmith'
import * as launchDarklyTools from '@/tools/launchdarkly'
import * as newRelicTools from '@/tools/new_relic'
import { prepareToolRequestUrl } from '@/tools/request-transport'
import * as sendGridTools from '@/tools/sendgrid'
import * as sentryTools from '@/tools/sentry'
import * as squareTools from '@/tools/square'
import { type ExecutableToolConfig, isInternalToolConfig, type ToolConfig } from '@/tools/types'

/**
 * Tool families whose saved credential carries the region, instance, or host its token belongs
 * to. Every tool must send a run made with such a credential to that host, and a run without one
 * (an inline key in a legacy block) to the host the tools always used.
 */
const FAMILIES: {
  service: string
  tools: Record<string, ExecutableToolConfig>
  defaultHost: string
  regions: [domain: string, host: string][]
  /**
   * Whether a region the tools don't know is refused. Tools whose region was already an inline
   * block field before saved credentials existed keep sending an unknown value to the default
   * host, as legacy workflows always did; the credential check refuses one before it is saved.
   */
  refusesUnknownRegion: boolean
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
    refusesUnknownRegion: true,
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
    refusesUnknownRegion: true,
  },
  {
    service: 'New Relic',
    tools: newRelicTools,
    defaultHost: 'api.newrelic.com',
    regions: [
      ['us', 'api.newrelic.com'],
      ['eu', 'api.eu.newrelic.com'],
      ['jp', 'api.jp.newrelic.com'],
    ],
    refusesUnknownRegion: false,
  },
  {
    service: 'Square',
    tools: squareTools,
    defaultHost: 'connect.squareup.com',
    regions: [
      ['production', 'connect.squareup.com'],
      ['sandbox', 'connect.squareupsandbox.com'],
    ],
    refusesUnknownRegion: true,
  },
  {
    service: 'SendGrid',
    tools: sendGridTools,
    defaultHost: 'api.sendgrid.com',
    regions: [
      ['global', 'api.sendgrid.com'],
      ['eu', 'api.eu.sendgrid.com'],
    ],
    refusesUnknownRegion: true,
  },
  {
    service: 'Hex',
    tools: hexTools,
    defaultHost: 'app.hex.tech',
    regions: [
      ['app.hex.tech', 'app.hex.tech'],
      ['eu.hex.tech', 'eu.hex.tech'],
      ['acme.hex.tech', 'acme.hex.tech'],
    ],
    refusesUnknownRegion: true,
  },
  {
    service: 'Sentry',
    tools: sentryTools,
    defaultHost: 'sentry.io',
    regions: [
      ['us', 'sentry.io'],
      ['de', 'de.sentry.io'],
    ],
    refusesUnknownRegion: true,
  },
]

/**
 * A value of each required param's type, so every URL builder can run. Optional params are left
 * unset, and so are hidden ones: only a saved credential fills them.
 */
function placeholderParams(tool: ExecutableToolConfig): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(tool.params)
      .filter(([, param]) => param.required === true && param.visibility !== 'hidden')
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

/** Tools that send their own request; an internal operation's host is checked by its own test. */
const cases = FAMILIES.flatMap((family) =>
  Object.values(family.tools).flatMap((tool) =>
    isInternalToolConfig(tool) ? [] : [{ ...family, tool }]
  )
)

describe.each(cases)('$tool.id', ({ tool, defaultHost, regions, refusesUnknownRegion }) => {
  it.each(regions)('sends a run with a saved %s credential to %s', (domain, host) => {
    expect(requestHost(tool, { accessToken: 'saved-token', domain })).toBe(host)
  })

  it(`keeps a run without a saved credential on ${defaultHost}`, () => {
    expect(requestHost(tool)).toBe(defaultHost)
  })

  it('never sends a region it does not know to a host off the vendor', () => {
    const run = () => requestHost(tool, { accessToken: 'saved-token', domain: 'evil.example.com' })
    if (refusesUnknownRegion) expect(run).toThrow()
    else expect(run()).toBe(defaultHost)
  })
})
