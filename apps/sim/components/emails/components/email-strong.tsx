import { fontWeight } from '@/components/emails/_styles'

const STRONG_STYLE = { fontWeight: fontWeight.semibold } as const

interface EmailStrongProps {
  children: React.ReactNode
}

/**
 * Inline emphasis inside body copy.
 *
 * A bare `strong` element inherits the client's UA weight of 700, which is off
 * the platform's three-step scale (400/500/600) and reads noticeably heavier
 * than anything in the app. This pins it to semibold while keeping the element
 * itself, so the emphasis stays semantic for screen readers.
 */
export function EmailStrong({ children }: EmailStrongProps) {
  return <strong style={STRONG_STYLE}>{children}</strong>
}

export default EmailStrong
