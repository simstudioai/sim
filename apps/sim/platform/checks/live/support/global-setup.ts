import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/

/**
 * Refuses to start unless `PLATFORM_LIVE_ORIGIN` resolves only to this machine. The suite signs
 * session cookies with the app's secret and writes to its database, so an origin that resolves
 * elsewhere (a hosts entry missing on a runner, a typo for a real Sim hostname) must stop the run
 * before any check sends a request there. CI maps the hosted hostname to loopback in /etc/hosts.
 */
export default async function assertLoopbackOrigin() {
  const origin = new URL(process.env.PLATFORM_LIVE_ORIGIN ?? 'http://localhost:3000')
  const host = origin.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map(({ address }) => address)
  const elsewhere = addresses.filter((address) => !LOOPBACK.test(address))
  if (addresses.length === 0 || elsewhere.length > 0) {
    throw new Error(
      `PLATFORM_LIVE_ORIGIN ${origin.origin} must resolve to loopback only; it resolves to ${addresses.join(', ') || 'nothing'}`
    )
  }
}
