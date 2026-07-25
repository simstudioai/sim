import { spawnSync } from 'node:child_process'
import { sha256Base64Url } from '@sim/security/hash'
import { generateSecureToken } from '@sim/security/tokens'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import * as p from './prompter.ts'
import { link, theme } from './theme.ts'

// Generous enough for a first-time user to create an account, wait for the email
// OTP, land back on /cli/auth, and approve — a few minutes is routine. The
// server-side approval record has its own short TTL, so a long client wait only
// costs cheap, rate-limited polls.
const WAIT_MS = 900_000
const POLL_INTERVAL_MS = 2000

function openBrowser(url: string): void {
  if (process.env.SIM_SETUP_NO_BROWSER) return
  if (process.platform === 'win32') {
    // `start` is a cmd builtin, not an executable — spawning it directly ENOENTs.
    // cmd re-parses the command line and would treat `&` in the query string as a
    // command separator, truncating the URL; quote it (the query is URL-encoded, so
    // it never contains a `"`) and pass args verbatim so Node doesn't re-quote them.
    // `""` is start's window-title placeholder, required before the URL.
    spawnSync('cmd', ['/c', 'start', '""', `"${url}"`], {
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    })
    return
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawnSync(command, [url], { stdio: 'ignore' })
}

/** No O/0 or I/1 — this exists to be compared by eye against a browser tab. */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Short human-comparable code, shown in this terminal and on the approval page.
 *
 * The poll secret binds the *key* to this process, but nothing cryptographic
 * tells the user whether the page they're approving belongs to their terminal
 * or to a link someone sent them — an attacker supplies the request id and
 * challenge. Comparing this code is the only thing that distinguishes the two.
 */
function createPairingCode(): string {
  const chars = generateShortId(8, PAIRING_ALPHABET)
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

interface PollResponse {
  status: 'pending' | 'complete'
  key?: { apiKey?: string }
}

/**
 * Device-flow handoff: open the approval page and poll for the key over TLS.
 *
 * No loopback listener — the terminal and browser need not share a machine, so
 * this works over SSH and inside containers. The poll secret never leaves this
 * process; only its digest reaches the server, so an observer of the request id
 * cannot mint. Returns the key, or null on timeout / failed poll (re-run to
 * retry). Ctrl-C exits setup via the SIGINT handler.
 */
export async function browserKeyFlow(origin: string): Promise<string | null> {
  const request = generateSecureToken(32)
  const pollSecret = generateSecureToken(32)
  const challenge = sha256Base64Url(pollSecret)
  const pairingCode = createPairingCode()

  const query = new URLSearchParams({ request, challenge, pairing: pairingCode })
  const authUrl = `${origin}/cli/auth?${query}`

  p.note(
    `${theme.heading(pairingCode)}\n\n${theme.muted('The page should show this code. If it shows a different one,\nthe request is not from this terminal — close the tab.')}`,
    'Confirm this code in your browser'
  )
  p.log.info(
    `Opening your browser — sign in and approve; the key comes back automatically.\n   If it doesn't open: ${link(authUrl, authUrl)}`
  )
  openBrowser(authUrl)

  const spin = p.spinner()
  spin.start('Waiting for approval in your browser')

  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    // null means still pending or a transient error — either way, keep waiting.
    const key = await pollOnce(origin, request, pollSecret)
    if (key) {
      spin.stop('Approved')
      return key
    }
  }

  spin.stop('Browser handoff timed out')
  return null
}

/**
 * One poll. Returns the key when the approval completes, `null` while pending or
 * on a transient error (the caller keeps waiting until the deadline).
 */
async function pollOnce(origin: string, request: string, verifier: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/cli/auth/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request, verifier }),
    })
    if (!response.ok) return null

    const data = (await response.json()) as PollResponse
    return data.status === 'complete' ? (data.key?.apiKey ?? null) : null
  } catch {
    return null
  }
}
