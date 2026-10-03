import { isPlainRecord } from '@sim/utils/object'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { fetchGoogleApiWithRetry } from '@/connectors/google-workspace/api-errors'

interface GmailProfile {
  emailAddress: string
  historyId: string
}

/** Sync-local only: never persist tokens or share mailbox identity across credentials. */
const mailboxes = new WeakMap<
  Record<string, unknown>,
  { accessToken: string; email: Promise<string> }
>()

/** Always reads a fresh history watermark; only mailbox identity is reused within a sync. */
export async function getGmailProfile(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<GmailProfile> {
  const signal = syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
  signal?.throwIfAborted()
  const response = await fetchGoogleApiWithRetry(
    'gmail.users.getProfile',
    'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress,historyId',
    {
      method: 'GET',
      signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }
  )
  const data = await readResponseJsonWithLimit(response, {
    maxBytes: 16 * 1024,
    label: 'Gmail profile',
  })
  if (
    !isPlainRecord(data) ||
    typeof data.emailAddress !== 'string' ||
    !isValidEmailSyntax(data.emailAddress) ||
    typeof data.historyId !== 'string' ||
    !/^\d+$/.test(data.historyId)
  ) {
    throw new Error('Gmail returned malformed profile metadata')
  }
  const emailAddress = normalizeEmail(data.emailAddress)
  if (syncContext) {
    mailboxes.set(syncContext, { accessToken, email: Promise.resolve(emailAddress) })
  }
  return { emailAddress, historyId: data.historyId }
}

export function getGmailMailboxEmail(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cached = syncContext && mailboxes.get(syncContext)
  if (cached?.accessToken === accessToken) return cached.email
  const email = getGmailProfile(accessToken, syncContext).then((profile) => profile.emailAddress)
  if (syncContext) {
    mailboxes.set(syncContext, { accessToken, email })
    void email.catch(() => {
      if (mailboxes.get(syncContext)?.email === email) mailboxes.delete(syncContext)
    })
  }
  return email
}

/** The chooser handles signed-out mailboxes; authuser alone can fall back to account zero. */
export function gmailThreadUrl(threadId: string, mailboxEmail: string): string {
  const thread = new URL('https://mail.google.com/mail/')
  thread.searchParams.set('authuser', mailboxEmail)
  thread.hash = `all/${encodeURIComponent(threadId)}`
  const chooser = new URL('https://accounts.google.com/AccountChooser')
  chooser.searchParams.set('Email', mailboxEmail)
  chooser.searchParams.set('continue', thread.toString())
  return chooser.toString()
}
