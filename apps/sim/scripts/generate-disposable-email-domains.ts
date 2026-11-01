/**
 * Regenerates `lib/messaging/email/disposable-email-domains.json`, the list behind the hosted
 * signup gate (`lib/messaging/email/disposable.ts`).
 *
 * Source: the curated CC0 blocklist of
 * https://github.com/disposable-email-domains/disposable-email-domains (the list PyPI uses),
 * pinned to a commit so the reviewed diff is exactly what ships. The larger auto-generated
 * `disposable/disposable-email-domains` list is deliberately not used: it carries real companies
 * and ISPs (railway.com, namecheap.com, q.com) and public suffixes.
 *
 * Dropped from upstream:
 * - every public suffix, ICANN or private section (`msk.ru`, `dyndns.org`, `pp.ua`): the gate
 *   also matches parent domains, so a suffix would refuse every organization registered under it;
 * - forwarding relays, whose aliases deliver to a real, permanent inbox;
 * - the reviewed real providers in `LEGITIMATE_DOMAINS`.
 *
 * Usage, from apps/sim: `bun run generate:disposable-email-domains [path-to-blocklist.conf]`. With
 * no path it downloads the pinned commit. To refresh, bump `UPSTREAM_COMMIT`, run it, and review
 * the diff against the Tranco top list for mainstream providers and companies.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { parse } from 'tldts'

const logger = createLogger('VendorDisposableEmailDomains')

const UPSTREAM_COMMIT = 'e2254bf7fc8dcf113f6028b21e263a352111490b'
const UPSTREAM_URL = `https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/${UPSTREAM_COMMIT}/disposable_email_blocklist.conf`

const OUTPUT_PATH = fileURLToPath(
  new URL('../lib/messaging/email/disposable-email-domains.json', import.meta.url)
)

/** Forwarding services: an alias under one of these, or the domain itself, is never dropped in. */
const MAIL_RELAY_DOMAINS: readonly string[] = [
  '33mail.com',
  'abinemail.com',
  'addy.io',
  'addy.to',
  'aleeas.com',
  'anonaddy.com',
  'anonaddy.me',
  'duck.com',
  'maskmy.id',
  'mozmail.com',
  'passinbox.com',
  'passmail.com',
  'passmail.net',
  'privaterelay.appleid.com',
  'relay.firefox.com',
  'simplelogin.co',
  'simplelogin.com',
  'simplelogin.fr',
  'slmail.me',
]

/**
 * Upstream entries that are real mail providers or companies, found by intersecting the list with
 * the Tranco top 100k. The remaining hits there are disposable inboxes (yopmail.com,
 * temp-mail.org) or free shared-subdomain services (mooo.com, ydns.eu), which stay listed.
 */
const LEGITIMATE_DOMAINS: readonly string[] = [
  // China Telecom's Guangdong portal and its customer mail service.
  '21cn.com',
  // Hola Networks, the VPN company, whose staff and support write from it.
  'hola.org',
  // Sify Technologies, an Indian ISP that hosts customer mail.
  'sify.com',
]

function isUnder(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`)
}

async function readUpstream(): Promise<string> {
  const localPath = process.argv[2]
  if (localPath) return readFile(localPath, 'utf8')

  const response = await fetch(UPSTREAM_URL)
  if (!response.ok) throw new Error(`Fetching ${UPSTREAM_URL} failed: ${response.status}`)
  return response.text()
}

const upstream = [
  ...new Set(
    (await readUpstream())
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#'))
  ),
]

const publicSuffixes = upstream.filter(
  (entry) => parse(entry, { allowPrivateDomains: true }).domain === null
)
const relays = upstream.filter((entry) => MAIL_RELAY_DOMAINS.some((relay) => isUnder(entry, relay)))
const legitimate = upstream.filter((entry) => LEGITIMATE_DOMAINS.includes(entry))
const dropped = new Set([...publicSuffixes, ...relays, ...legitimate])

const domains = upstream.filter((entry) => !dropped.has(entry)).sort()

await writeFile(OUTPUT_PATH, `${JSON.stringify(domains, null, 2)}\n`)

logger.info('Wrote the disposable email domain list', {
  upstreamCommit: UPSTREAM_COMMIT,
  upstream: upstream.length,
  written: domains.length,
  publicSuffixes,
  relays,
  legitimate,
})
