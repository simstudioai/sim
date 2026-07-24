import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { E2E_HOST, E2E_MCP_HOST } from './deployment-profile'

export const E2E_HOSTS = [E2E_HOST, E2E_MCP_HOST] as const

export function isLoopbackAddress(address: string): boolean {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true
  if (isIP(address) === 4) {
    const first = Number(address.split('.')[0])
    return first === 127
  }
  return false
}

export function areValidE2eHostAddresses(addresses: string[]): boolean {
  return (
    addresses.length > 0 && addresses.every(isLoopbackAddress) && addresses.includes('127.0.0.1')
  )
}

export async function assertE2eHostResolvesToLoopback(hostname = E2E_HOST): Promise<string[]> {
  let records: Array<{ address: string }>
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error(getHostMappingError(hostname, []))
  }

  const addresses = [...new Set(records.map(({ address }) => address))]
  if (!areValidE2eHostAddresses(addresses)) {
    throw new Error(getHostMappingError(hostname, addresses))
  }
  return addresses
}

export async function assertE2eHostsResolveToLoopback(
  hostnames: readonly string[] = E2E_HOSTS
): Promise<Record<string, string[]>> {
  const resolved = await Promise.all(
    hostnames.map(
      async (hostname) => [hostname, await assertE2eHostResolvesToLoopback(hostname)] as const
    )
  )
  return Object.fromEntries(resolved)
}

function getHostMappingError(hostname: string, addresses: string[]): string {
  const observed = addresses.length > 0 ? addresses.join(', ') : 'no addresses'
  return [
    `${hostname} must resolve only to loopback and include IPv4 127.0.0.1; observed ${observed}.`,
    `Add the required E2E mappings once with: echo "127.0.0.1 ${E2E_HOST} ${E2E_MCP_HOST}" | sudo tee -a /etc/hosts`,
  ].join(' ')
}
