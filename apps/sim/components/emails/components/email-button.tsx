import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'

/** `Link` renders an underline by default; the pill owns its own chrome. */
const RESET_LINK_STYLE = { textDecoration: 'none' } as const

interface EmailButtonProps {
  href: string
  children: React.ReactNode
}

/**
 * The primary CTA pill — a `Link` wrapping a `Text` so the tappable area covers
 * the whole pill in clients that ignore padding on an anchor.
 *
 * Every template repeated this three-node shape verbatim, including the
 * underline reset; the styling lives in {@link baseStyles.button}, which
 * transcribes the platform's primary Chip.
 */
export function EmailButton({ href, children }: EmailButtonProps) {
  return (
    <Link href={href} style={RESET_LINK_STYLE}>
      <Text style={baseStyles.button}>{children}</Text>
    </Link>
  )
}

export default EmailButton
