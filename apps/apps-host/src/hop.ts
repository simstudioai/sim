import { createHash, createHmac } from 'node:crypto'

export function createAppsHopProof(
  secret: string,
  method: string,
  path: string,
  body: string | Buffer | Uint8Array = '',
  now = Date.now()
): string {
  const ts = String(now)
  const bodyDigest = createHash('sha256').update(body).digest('hex')
  const payload = `${ts}.${method.toUpperCase()}.${path}.${bodyDigest}`
  const digest = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  return `${ts}.${digest}`
}
