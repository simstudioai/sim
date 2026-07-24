import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import * as p from './prompter.ts'
import { link, theme } from './theme.ts'

const WAIT_MS = 180_000

function openBrowser(url: string): void {
  if (process.env.SIM_SETUP_NO_BROWSER) return
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawnSync(command, [url], { stdio: 'ignore' })
}

/**
 * PKCE pair. The verifier never leaves this process — only its digest travels
 * through the browser — so a code intercepted in transit cannot be redeemed.
 */
function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** No O/0 or I/1 — this exists to be compared by eye against a browser tab. */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Short human-comparable code, shown in this terminal and on the approval page.
 *
 * PKCE binds the *code* to this process, but it cannot tell you whether the page
 * you're approving belongs to your terminal or to a link someone sent you — the
 * attacker in that case supplies their own callback and challenge. Comparing
 * this value is the only thing that distinguishes the two, so if the page shows
 * a code you don't recognise, the approval isn't yours.
 */
function createPairingCode(): string {
  const bytes = randomBytes(8)
  const chars = Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

export interface CodeListener {
  authUrl: string
  verifier: string
  pairingCode: string
  code: Promise<string | null>
  close: () => void
}

/**
 * Loopback listener for the /cli/auth browser handoff. Contract:
 * GET /callback?code=<code>&state=<state>, where state must echo our nonce.
 *
 * `code` resolves with the delivered code, or null on timeout/close/state
 * mismatch.
 */
export function startCodeListener(origin: string): Promise<CodeListener> {
  const state = randomBytes(16).toString('hex')
  const { verifier, challenge } = createPkcePair()
  const pairingCode = createPairingCode()

  return new Promise((resolveListener) => {
    let settled = false
    let finish: (code: string | null) => void
    const code = new Promise<string | null>((resolveCode) => {
      finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        server.close()
        resolveCode(value)
      }
    })

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const deliveredCode = url.searchParams.get('code')
      const echoedState = url.searchParams.get('state')
      if (!deliveredCode || echoedState !== state) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('state mismatch — re-run setup')
        finish(null)
        return
      }
      res.writeHead(302, { location: `${origin}/cli/auth/done` }).end()
      finish(deliveredCode)
    })

    const timer = setTimeout(() => finish(null), WAIT_MS)

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('loopback listener failed to bind')
      const callback = `http://127.0.0.1:${address.port}/callback`
      const query = new URLSearchParams({ callback, state, challenge, pairing: pairingCode })
      resolveListener({
        authUrl: `${origin}/cli/auth?${query}`,
        verifier,
        pairingCode,
        code,
        close: () => finish(null),
      })
    })
  })
}

/** Single-use, expires in two minutes — a failure means re-running the flow, not retrying. */
async function exchangeCode(
  origin: string,
  code: string,
  verifier: string
): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/cli/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    })

    if (!response.ok) {
      p.log.warn(`Sim rejected the authorization code (${response.status}). Re-run setup to retry.`)
      return null
    }

    const data = (await response.json()) as { key?: { apiKey?: string } }
    return data.key?.apiKey ?? null
  } catch {
    p.log.warn(`Could not reach ${origin} to redeem the authorization code.`)
    return null
  }
}

/**
 * Waits for the browser handoff and redeems the code it returns. Null on
 * timeout or a failed exchange; ctrl-c exits setup via the SIGINT handler.
 */
export async function browserKeyFlow(origin: string): Promise<string | null> {
  const listener = await startCodeListener(origin)
  p.note(
    `${theme.heading(listener.pairingCode)}\n\n${theme.muted('The page should show this code. If it shows a different one,\nthe request is not from this terminal — close the tab.')}`,
    'Confirm this code in your browser'
  )
  p.log.info(
    `Opening your browser — sign in and approve; the key comes back automatically.\n   If it doesn't open: ${link(listener.authUrl, listener.authUrl)}`
  )
  openBrowser(listener.authUrl)

  const spin = p.spinner()
  spin.start('Waiting for approval in your browser')
  const code = await listener.code
  spin.stop(code ? 'Approved' : 'Browser handoff timed out')

  if (!code) return null

  return exchangeCode(origin, code, listener.verifier)
}
