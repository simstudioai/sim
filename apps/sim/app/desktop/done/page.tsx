import type { Metadata } from 'next'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'

export const metadata: Metadata = {
  title: 'Return to Sim',
  robots: { index: false },
}

const COPY = {
  auth: {
    title: 'You’re signed in',
    description: 'Return to the Sim desktop app — you can close this tab.',
  },
  connect: {
    title: 'Connection finished',
    description: 'Return to the Sim desktop app — you can close this tab.',
  },
} as const

type HandoffKind = keyof typeof COPY

interface DesktopDonePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The end of a desktop handoff, shown in the browser after the app's loopback
 * listener has taken the callback. The loopback redirects here rather than
 * serving its own HTML so this screen uses the real design system instead of a
 * hand-rolled page inlined in the Electron main process.
 *
 * Purely informational — by the time it renders, the handoff has already
 * completed in the app, and the app has focused itself.
 */
export default async function DesktopDonePage({ searchParams }: DesktopDonePageProps) {
  const params = await searchParams
  const kind = params.kind
  const copy = typeof kind === 'string' && kind in COPY ? COPY[kind as HandoffKind] : COPY.auth
  return <DesktopHandoffShell title={copy.title} description={copy.description} />
}
