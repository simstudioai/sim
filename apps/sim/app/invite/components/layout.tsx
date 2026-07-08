import { AuthShell, SupportFooter } from '@/app/(auth)/components'

interface InviteLayoutProps {
  children: React.ReactNode
}

/**
 * Invite pages wear the same light auth shell as login/signup — the shared
 * {@link AuthShell} (logo-only header, centered column) plus the support footer —
 * so the invite-to-workspace flow is visually aligned with the rest of auth.
 */
export default function InviteLayout({ children }: InviteLayoutProps) {
  return <AuthShell footer={<SupportFooter position='static' />}>{children}</AuthShell>
}
