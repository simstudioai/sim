import { describe, expect, it } from 'vitest'
import {
  createEgressPolicy,
  type EgressPolicy,
  evaluateAddress,
  evaluateUrl,
  STRICT_EGRESS_POLICY,
} from './egress'

/** The hosted posture: vouches for nothing, no matter what an operator wrote. */
const hosted = STRICT_EGRESS_POLICY

/** A self-hosted posture with a typical Docker/K8s allowlist. */
const selfHosted = createEgressPolicy({
  allowedHosts: 'host.docker.internal,*.svc.cluster.local',
  allowedRanges: '10.0.0.0/8,192.168.65.254/32',
  insecureHttp: 'whenVouched',
})

function decide(policy: EgressPolicy, href: string, address?: string) {
  const url = new URL(href)
  return address === undefined ? evaluateUrl(url, policy) : evaluateAddress(url, address, policy)
}

function reason(policy: EgressPolicy, href: string, address?: string) {
  const decision = decide(policy, href, address)
  return decision.allowed ? null : decision.reason
}

describe('evaluateUrl — scheme shape', () => {
  it.each([
    ['file:///etc/passwd', 'local file'],
    ['gopher://example.com/', 'gopher smuggling'],
    ['ftp://example.com/', 'ftp'],
    ['data:text/plain,hi', 'data URI'],
  ])('rejects %s — %s', (href) => {
    expect(reason(hosted, href)).toBe('scheme-not-permitted')
  })

  it('rejects plain http to an unvouched host', () => {
    expect(reason(hosted, 'http://example.com/')).toBe('insecure-scheme')
  })

  it('allows https to a public host', () => {
    expect(decide(hosted, 'https://example.com/', '93.184.216.34').allowed).toBe(true)
  })
})

describe('evaluateUrl — IP-literal hosts resolve without DNS', () => {
  it.each([
    ['https://127.0.0.1/', 'address-loopback', 'IPv4 loopback'],
    ['https://[::1]/', 'address-loopback', 'IPv6 loopback'],
    ['https://127.0.0.5/', 'address-loopback', 'the whole 127/8 range, not just .1'],
    ['https://10.1.2.3/', 'address-blocked', 'RFC1918 10/8'],
    ['https://192.168.1.1/', 'address-blocked', 'RFC1918 192.168/16'],
    ['https://172.16.0.1/', 'address-blocked', 'RFC1918 172.16/12'],
    ['https://169.254.1.1/', 'address-blocked', 'link-local'],
    ['https://0177.0.0.1/', 'address-loopback', 'octal IPv4 encoding'],
    ['https://[::ffff:127.0.0.1]/', 'address-loopback', 'IPv4-mapped IPv6'],
  ])('rejects %s as %s — %s', (href, expected) => {
    expect(reason(hosted, href)).toBe(expected)
  })
})

describe('cloud metadata is never reachable', () => {
  const metadata = [
    ['169.254.169.254', 'AWS/Azure/GCP IMDS'],
    ['169.254.170.2', 'AWS ECS task metadata'],
    ['100.100.100.200', 'Alibaba Cloud'],
    ['192.0.0.192', 'Oracle Cloud'],
    ['168.63.129.16', 'Azure WireServer'],
  ] as const

  it.each(metadata)('blocks %s on the hosted posture — %s', (ip) => {
    expect(reason(hosted, `https://${ip}/`)).toBe('address-metadata')
  })

  it.each(metadata)('blocks %s even when an operator allowlists it outright — %s', (ip) => {
    const permissive = createEgressPolicy({
      allowedRanges: `${ip}/32`,
      insecureHttp: 'whenVouched',
    })
    expect(reason(permissive, `https://${ip}/`)).toBe('address-metadata')
  })

  it('blocks metadata behind a broad operator range allowlist', () => {
    const permissive = createEgressPolicy({ allowedRanges: '169.254.0.0/16' })
    expect(reason(permissive, 'https://169.254.169.254/')).toBe('address-metadata')
    // ...while the rest of the allowlisted range still works.
    expect(decide(permissive, 'https://169.254.1.1/').allowed).toBe(true)
  })

  it.each([
    ['64:ff9b::a9fe:a9fe', 'the NAT64 form a DNS64 resolver returns'],
    ['64:ff9b::169.254.169.254', 'NAT64 written long-hand'],
  ])('blocks %s through an allowlisted hostname — %s', (address) => {
    const permissive = createEgressPolicy({ allowedHosts: 'internal.corp' })
    expect(reason(permissive, 'https://internal.corp/', address)).toBe('address-metadata')
  })

  it.each([
    ['::a9fe:a9fe', 'the IPv4-compatible form the URL parser normalizes to'],
    ['::ffff:169.254.169.254', 'the IPv4-mapped form'],
    ['::169.254.169.254', 'written long-hand'],
  ])('blocks %s — %s', (address) => {
    const permissive = createEgressPolicy({ allowedHosts: 'metadata.internal' })
    expect(reason(permissive, 'https://metadata.internal/', address)).toBe('address-metadata')
  })
})

describe('operator allowlist — the self-hosted posture', () => {
  it('permits plain http to an allowlisted hostname (issue #7200)', () => {
    expect(
      decide(selfHosted, 'http://host.docker.internal:7274/v1/x', '192.168.65.254').allowed
    ).toBe(true)
  })

  it('permits an allowlisted hostname regardless of the private address it resolves to', () => {
    expect(decide(selfHosted, 'http://host.docker.internal/', '172.17.0.1').allowed).toBe(true)
  })

  it('permits an address inside an allowlisted range even for an unlisted hostname', () => {
    expect(decide(selfHosted, 'http://build-box.corp/', '10.9.9.9').allowed).toBe(true)
  })

  it('still refuses a private address outside every allowlist entry', () => {
    expect(reason(selfHosted, 'https://other.corp/', '172.16.4.4')).toBe('address-blocked')
  })

  it('does not let a wildcard match a bare suffix or a different domain', () => {
    // Addresses here sit outside the allowlisted 10/8, so only a hostname match
    // could permit them — which is exactly what is being asserted absent.
    expect(reason(selfHosted, 'https://svc.cluster.local/', '172.16.1.1')).toBe('address-blocked')
    expect(reason(selfHosted, 'https://evil-svc.cluster.local.attacker.com/', '172.16.1.1')).toBe(
      'address-blocked'
    )
  })
})

describe('an IPv4 range matches every spelling of the same address', () => {
  const ranged = createEgressPolicy({ allowedRanges: '10.0.0.0/8' })

  it.each([
    ['10.0.0.1', 'plain IPv4'],
    ['::a00:1', 'the IPv4-compatible form a resolver can return'],
    ['::ffff:10.0.0.1', 'the IPv4-mapped form'],
    ['::10.0.0.1', 'IPv4-compatible written long-hand'],
    ['64:ff9b::a00:1', 'the NAT64 form'],
  ])('permits %s — %s', (address) => {
    expect(decide(ranged, 'https://svc.internal/', address).allowed).toBe(true)
  })
})

describe('the same operator config is inert on the hosted posture', () => {
  it.each([
    ['http://host.docker.internal/', '192.168.65.254'],
    ['https://api.svc.cluster.local/', '10.4.5.6'],
    ['https://build-box.corp/', '10.9.9.9'],
  ])('refuses %s', (href, address) => {
    // `hosted` is built without the operator lists — the app layer drops them.
    expect(decide(hosted, href, address).allowed).toBe(false)
  })
})

describe('loopback is vouched by name, never by resolved address', () => {
  const selfHostedLoopback = createEgressPolicy({
    insecureHttp: 'whenVouched',
    allowLoopback: true,
  })

  it.each([
    ['http://localhost:11434/api', '127.0.0.1', 'a local Ollama'],
    ['http://127.0.0.1:8888/tree', '127.0.0.1', 'a local Jupyter'],
    ['http://[::1]:8080/', '::1', 'IPv6 loopback'],
    ['http://127.0.0.5:8080/', '127.0.0.5', 'the rest of 127/8'],
  ])('permits %s — %s', (href, address) => {
    expect(decide(selfHostedLoopback, href, address).allowed).toBe(true)
  })

  it('refuses a public hostname that merely resolves to loopback', () => {
    // The carve-out keys off the hostname. Keying it off the resolved address
    // would turn any attacker-controlled DNS name into a route to loopback.
    expect(reason(selfHostedLoopback, 'https://localtest.me/', '127.0.0.1')).toBe(
      'address-loopback'
    )
    expect(reason(selfHostedLoopback, 'https://127.0.0.1.nip.io/', '127.0.0.1')).toBe(
      'address-loopback'
    )
  })

  it('refuses when a resolver answers localhost with a routable address', () => {
    // The carve-out is for the loopback interface, not for whatever a resolver
    // decides `localhost` means today.
    expect(reason(selfHostedLoopback, 'https://localhost/api', '93.184.216.34')).toBe(null)
    expect(reason(selfHostedLoopback, 'https://localhost/api', '10.0.0.7')).toBe('address-blocked')
    expect(reason(selfHostedLoopback, 'http://localhost/api', '10.0.0.7')).toBe('insecure-scheme')
  })
})

describe('allowPrivate — the deprecated blanket flag', () => {
  const legacy = createEgressPolicy({ insecureHttp: 'whenVouched', allowPrivate: true })

  it('still cannot reach cloud metadata', () => {
    expect(reason(legacy, 'https://metadata/', '169.254.169.254')).toBe('address-metadata')
  })
})

describe('denied ports', () => {
  it.each([
    ['22', 'SSH'],
    ['3306', 'MySQL'],
    ['5432', 'PostgreSQL'],
    ['6379', 'Redis'],
    ['27017', 'MongoDB'],
  ])('refuses port %s on an unvouched host — %s', (port) => {
    expect(reason(hosted, `https://example.com:${port}/`)).toBe('port-denied')
  })

  it('lifts the port denylist for a vouched destination', () => {
    // Being vouched is what lifts it, which is why no profile needs its own
    // opt-out: an internal Elasticsearch is reachable because it was named.
    expect(decide(selfHosted, 'http://host.docker.internal:9200/', '10.0.0.5').allowed).toBe(true)
  })

  it('keeps refusing a service port on a public host, whatever the profile', () => {
    const selfHostedService = createEgressPolicy({ insecureHttp: 'always', allowLoopback: true })
    expect(reason(selfHostedService, 'http://example.com:5432/', '93.184.216.34')).toBe(
      'port-denied'
    )
  })
})

describe('evaluateAddress is authoritative for DNS names', () => {
  it('refuses a public hostname that resolves into private space', () => {
    expect(reason(hosted, 'https://rebind.example.com/', '10.0.0.1')).toBe('address-blocked')
  })
})

describe('invalid input fails closed', () => {
  it.each([['not-an-ip'], [''], ['999.999.999.999'], ['::gg']])(
    'refuses the unparseable address %s',
    (address) => {
      expect(decide(hosted, 'https://example.com/', address).allowed).toBe(false)
    }
  )
})

describe('createEgressPolicy rejects malformed operator config', () => {
  it('refuses a catch-all network', () => {
    expect(() => createEgressPolicy({ allowedRanges: '0.0.0.0/0' })).toThrow(/catch-all/)
  })

  it('refuses a host entry carrying a port, comma, or colon', () => {
    expect(() => createEgressPolicy({ allowedHosts: 'a.com:8080' })).toThrow(
      /port, comma, or colon/
    )
    expect(() => createEgressPolicy({ allowedHosts: ['a.com,b.com'] })).toThrow(
      /port, comma, or colon/
    )
  })
})

describe('must not over-block', () => {
  it.each([
    ['https://93.184.216.34/', 'public IPv4 literal'],
    ['https://[2606:2800:220:1:248:1893:25c8:1946]/', 'public IPv6 literal'],
    ['https://example.com:8080/', 'non-standard but permitted port'],
    ['https://example.com/path?q=1#frag', 'query and fragment'],
  ])('allows %s — %s', (href) => {
    expect(decide(hosted, href).allowed).toBe(true)
  })
})

describe('IPv6 forms that carry an IPv4 destination', () => {
  /** Vouches for a name, which is what would otherwise carry an address past the check. */
  const vouchesByName = createEgressPolicy({
    allowedHosts: 'internal.corp',
    insecureHttp: 'whenVouched',
  })

  it.each([
    ['::ffff:169.254.169.254', 'IPv4-mapped'],
    ['::a9fe:a9fe', 'deprecated IPv4-compatible'],
    ['64:ff9b::a9fe:a9fe', 'RFC 6052 well-known NAT64'],
    ['::ffff:0:a9fe:a9fe', 'RFC 6145 IPv4-translated'],
  ])('reads %s as the metadata endpoint it carries — %s', (address) => {
    expect(reason(vouchesByName, 'https://internal.corp/', address)).toBe('address-metadata')
  })

  it.each([
    ['2001:0:a9fe:a9fe::', 'Teredo, which carries two IPv4 addresses'],
    ['2001:0:1:2:0:5efe:80ff:fffe', 'Teredo whose layout collides with the ISATAP identifier'],
    ['::1:7f00:1', 'the reserved ::/64 block'],
    ['::ffff:1:a9fe:a9fe', 'one group outside the IPv4-translated prefix'],
  ])('refuses %s — %s', (address) => {
    expect(reason(hosted, 'https://example.com/', address)).toBe('address-blocked')
    expect(reason(vouchesByName, 'https://internal.corp/', address)).toBe('address-blocked')
  })
})

describe('an unparseable address is refused even for a vouched destination', () => {
  it('does not let a hostname allowlist entry carry it past the check', () => {
    const policy = createEgressPolicy({ allowedHosts: 'internal.corp' })
    expect(reason(policy, 'https://internal.corp/', 'not-an-ip')).toBe('address-blocked')
  })
})

describe('the loopback carve-out stops short of the port denylist', () => {
  const loopbackAllowed = createEgressPolicy({ allowLoopback: true, insecureHttp: 'whenVouched' })

  it.each([
    ['http://localhost:5432/', 'Postgres'],
    ['http://127.0.0.1:6379/', 'Redis'],
    ['http://localhost:22/', 'SSH'],
  ])('refuses %s — %s is where Sim listens, and nobody asked for it', (href) => {
    expect(reason(loopbackAllowed, href)).toBe('port-denied')
  })
})

describe('a name that says it is loopback is refused without a lookup', () => {
  it('refuses localhost before DNS when the policy does not permit loopback', () => {
    expect(reason(hosted, 'https://localhost/x')).toBe('address-loopback')
  })
})

describe('createEgressPolicy validates wildcard entries too', () => {
  it('matches a wildcard at any depth but never the bare apex', () => {
    const policy = createEgressPolicy({ allowedHosts: '*.svc.cluster.local' })
    expect(decide(policy, 'https://vllm.ai.svc.cluster.local/', '10.4.2.9').allowed).toBe(true)
    expect(decide(policy, 'https://svc.cluster.local/', '10.4.2.9').allowed).toBe(false)
  })
})

describe('a scope id does not change what an address is', () => {
  it('still reads a zoned metadata address as metadata', () => {
    const policy = createEgressPolicy({ allowPrivate: true })
    expect(reason(policy, 'https://pg.corp/', 'fd00:ec2::254%eth0')).toBe('address-metadata')
  })
})

describe('loopback names beyond the bare label', () => {
  it.each([
    ['https://localhost./x', 'a trailing dot'],
    ['https://foo.localhost/x', 'the RFC 6761 suffix'],
  ])('refuses %s pre-DNS — %s', (href) => {
    expect(reason(hosted, href)).toBe('address-loopback')
  })
})

describe('a trailing dot does not defeat the host allowlist', () => {
  it('matches an entry written without one', () => {
    const policy = createEgressPolicy({ allowedHosts: 'api.example.com' })
    expect(decide(policy, 'https://api.example.com./', '10.0.0.1').allowed).toBe(true)
  })
})

describe('an internationalized allowlist entry names the form that works', () => {
  it('refuses the Unicode spelling rather than silently never matching', () => {
    expect(() => createEgressPolicy({ allowedHosts: ['*.exämple.com'] })).toThrow(/punycode/)
  })
})
