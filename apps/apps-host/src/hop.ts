import { createHmac } from 'node:crypto'

export function createAppsHopProof(
  secret: string,
  method: string,
  path: string,
  now = Date.now()
): string {
  const ts = String(now)
  const payload = `${ts}.${method.toUpperCase()}.${path}`
  const digest = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  return `${ts}.${digest}`
}
