import { createHash, X509Certificate } from 'node:crypto'
import tls from 'node:tls'

/**
 * SubjectPublicKeyInfo SHA-256 of every root that chains to one of the eight
 * eMudhra intermediates whose private keys were reported compromised in October
 * 2026 (https://emudhra.we-have-a-problem.com/roots.json). Mozilla's root store
 * already excludes all four, so dropping them leaves the process trusting what
 * Firefox trusts. Upstream runtimes are fixing this with their own blocklists
 * (Node.js #66871, Bun #46159); once a deployed runtime ships one, these roots
 * are absent from its store and {@link distrustCompromisedRoots} changes nothing.
 */
const COMPROMISED_ROOT_SPKI_SHA256 = new Set([
  '8d417db2dd8bf5e3084d1e3f196d583849d81bdd4c00c70b9d39369e96b8c782', // emSign ECC Root CA - G3
  'c619e4780ed8e0abeda24ad732567de4383a7ea941338f6d1a7d1b49ac792fe9', // emSign Root TLS CA - G3
  '0a6c2b2ca5b364207954171987ac9d2178561569d8205457e77ca90c32ede282', // emSign Root CS CA - G3
  'bd153ed7b0434f6886b17bce8bbe84ed340c7132d702a8f4fa318f756ecbd6f3', // AAA Certificate Services
])

export interface DistrustCompromisedRootsResult {
  /** Subject CNs of the roots removed from the default CA set. */
  removed: string[]
  /** Set when the runtime cannot replace its default CA set; trust is unchanged. */
  unsupported?: boolean
  /** Set when reading or replacing the CA set failed; trust is unchanged. */
  error?: unknown
}

let applied: DistrustCompromisedRootsResult | undefined

function spkiSha256(certificate: X509Certificate): string {
  return createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

/**
 * Bun's `node:tls` verifies against the OS store as well as its bundled one,
 * but reports only the bundled roots as `default`, so replacing the default
 * with that list alone would silently drop the OS roots. Node's `default`
 * already is exactly what it verifies against.
 */
function currentTrustedCertificates(): string[] {
  if (!process.versions.bun) return tls.getCACertificates('default')
  return [
    ...tls.getCACertificates('default'),
    ...tls.getCACertificates('system'),
    ...tls.getCACertificates('extra'),
  ]
}

/**
 * Removes the compromised eMudhra roots from the process-wide default CA set,
 * so every TLS client created afterwards rejects chains through them. Call it
 * once at process start, before any outbound connection.
 *
 * Covers Node's `fetch` and every `node:tls` client (`https`, Postgres, Redis,
 * AWS SDK) under both Node and Bun. Bun's native `fetch` keeps its own compiled
 * store and ignores this, so it needs a Bun release with the updated roots.
 *
 * The CA set is replaced only when a compromised root is present in it, and
 * never on any other change: a certificate that cannot be parsed is kept, and
 * any failure leaves trust exactly as it was. Never throws.
 */
export function distrustCompromisedRoots(): DistrustCompromisedRootsResult {
  if (applied) return applied
  if (typeof tls.setDefaultCACertificates !== 'function') {
    applied = { removed: [], unsupported: true }
    return applied
  }

  try {
    const kept = new Map<string, string>()
    const removed = new Map<string, string>()
    for (const pem of currentTrustedCertificates()) {
      let certificate: X509Certificate
      try {
        certificate = new X509Certificate(pem)
      } catch {
        kept.set(pem, pem)
        continue
      }
      const fingerprint = certificate.fingerprint256
      if (kept.has(fingerprint) || removed.has(fingerprint)) continue
      if (COMPROMISED_ROOT_SPKI_SHA256.has(spkiSha256(certificate))) {
        removed.set(
          fingerprint,
          certificate.subject.match(/^CN=(.*)$/m)?.[1] ?? certificate.subject
        )
      } else {
        kept.set(fingerprint, pem)
      }
    }

    if (removed.size > 0) tls.setDefaultCACertificates([...kept.values()])
    applied = { removed: [...removed.values()] }
  } catch (error) {
    applied = { removed: [], error }
  }
  return applied
}
