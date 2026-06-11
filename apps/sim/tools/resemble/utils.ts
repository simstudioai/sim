export const DEFAULT_BASE_URL = 'https://app.resemble.ai/api/v2'
export const TERMINAL = new Set(['completed', 'failed', 'error', 'cancelled', 'success'])

export function baseOf(params: any): string {
  return (params?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function authHeaders(params: any, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${params?.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(extra || {}),
  }
}

export function rItem(d: any): any {
  return d && typeof d === 'object' && d.item && typeof d.item === 'object' ? d.item : d || {}
}

export function sanitize(d: any, n = 200): any {
  if (Array.isArray(d)) return d.map((x) => sanitize(x, n))
  if (d && typeof d === 'object') {
    const o: any = {}
    for (const k of Object.keys(d)) o[k] = sanitize(d[k], n)
    return o
  }
  if (typeof d === 'string' && d.startsWith('data:') && d.length > n) {
    return `<inline base64 omitted — ${d.length} chars>`
  }
  return d
}

export async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const r = await fetch(url, { headers })
  const text = await r.text()
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    j = { raw: text }
  }
  if (r.status >= 400) throw new Error((j && j.message) || `Resemble API error: HTTP ${r.status}`)
  return j
}

export function statusDone(d: any): boolean {
  return TERMINAL.has((rItem(d).status || '').toString().toLowerCase())
}

export async function pollResource(
  base: string,
  path: string,
  headers: Record<string, string>,
  maxWaitSeconds = 120,
  isDone: (d: any) => boolean = statusDone
): Promise<any> {
  const wait = Math.max(1, maxWaitSeconds)
  const deadline = Date.now() + wait * 1000
  let delay = 2000
  let last = await getJson(`${base}${path}`, headers)
  while (true) {
    if (isDone(last)) return last
    if (Date.now() >= deadline) {
      throw new Error(`Resemble job did not complete within ${wait}s (GET ${path})`)
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(10000, delay + 1000)
    last = await getJson(`${base}${path}`, headers)
  }
}
