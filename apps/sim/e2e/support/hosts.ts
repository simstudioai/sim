import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { E2E_HOST } from './deployment-profile'

export function isLoopbackAddress(address: string): boolean {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true
  if (isIP(address) === 4) {
    const first = Number(address.split('.')[0])
    return first === 127
  }
  return false
}

export async function assertE2eHostResolvesToLoopback(hostname = E2E_HOST): Promise<string[]> {
  let records: Array<{ address: string }>
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error(getHostMappingError(hostname, []))
  }

  const addresses = [...new Set(records.map(({ address }) => address))]
  if (addresses.length === 0 || addresses.some((address) => !isLoopbackAddress(address))) {
    throw new Error(getHostMappingError(hostname, addresses))
  }
  return addresses
}

function getHostMappingError(hostname: string, addresses: string[]): string {
  const observed = addresses.length > 0 ? addresses.join(', ') : 'no addresses'
  return [
    `${hostname} must resolve only to loopback; observed ${observed}.`,
    `Add it once with: echo "127.0.0.1 ${hostname}" | sudo tee -a /etc/hosts`,
  ].join(' ')
}
