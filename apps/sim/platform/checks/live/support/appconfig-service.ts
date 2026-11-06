import { createServer, type IncomingMessage } from 'node:http'

/**
 * Stands in for AWS AppConfig at the wire, through `AWS_ENDPOINT_URL_APPCONFIGDATA`, so targeting
 * runs the way it does in production: the real SDK client, session tokens, polling, in-process cache,
 * document parsing and rule evaluation. Only the `feature-flags` profile has a document, and a poll
 * with nothing new answers an empty body, as the service does. A profile with no document leaves the
 * app on its own fallback.
 *
 * `PUT /__control/platform-org-ui` with `{ "orgIds": [...] }` publishes a new document, as a rollout
 * or a rollback does.
 *
 * Off AppConfig each flag reads its own environment variable. On it the document is the only source,
 * so this carries the flags the seeded surface relies on.
 */
const port = Number(process.argv[2])
const organizationId = process.env.PLATFORM_LIVE_ORGANIZATION_ID
if (!port || !organizationId) {
  throw new Error('usage: PLATFORM_LIVE_ORGANIZATION_ID=<id> appconfig-service.ts <port>')
}

const FEATURE_FLAGS = 'feature-flags'
const POLL_INTERVAL_SECONDS = 15

let revision = 0
let targetedOrganizationIds = [organizationId]

function featureFlags() {
  return JSON.stringify({
    'platform-org-ui': { orgIds: targetedOrganizationIds },
    people: { enabled: true },
    'sim-links': { enabled: true },
    'knowledge-member-access': { enabled: true },
  })
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** A session token names its profile and the revision that session last received. */
const tokenFor = (profile: string, seenRevision: number) => `${profile}:${seenRevision}`

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const reply = async () => {
    if (url.pathname === '/health') {
      response.writeHead(200)
      response.end()
      return
    }
    if (request.method === 'PUT' && url.pathname === '/__control/platform-org-ui') {
      const { orgIds } = await readJson(request)
      if (!Array.isArray(orgIds)) throw new Error('orgIds must be an array')
      targetedOrganizationIds = orgIds.map(String)
      revision += 1
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method === 'POST' && url.pathname === '/configurationsessions') {
      const { ConfigurationProfileIdentifier: profile } = await readJson(request)
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ InitialConfigurationToken: tokenFor(String(profile), -1) }))
      return
    }
    if (request.method === 'GET' && url.pathname === '/configuration') {
      const [profile = '', seen = ''] = (url.searchParams.get('configuration_token') ?? '').split(
        ':'
      )
      const stale = profile === FEATURE_FLAGS && Number(seen) !== revision
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Next-Poll-Configuration-Token': tokenFor(profile, revision),
        'Next-Poll-Interval-In-Seconds': String(POLL_INTERVAL_SECONDS),
      })
      response.end(stale ? featureFlags() : '')
      return
    }
    response.writeHead(404)
    response.end()
  }
  reply().catch(() => {
    response.writeHead(500)
    response.end()
  })
}).listen(port, '127.0.0.1')
