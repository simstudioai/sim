import { ChipLink } from '@/components/emcn'

interface AuthNavPromptProps {
  /** Muted lead text before the link (e.g. "Don't have an account?"). */
  prompt?: string
  href: string
  linkLabel: string
  /** Side effect to run before navigation (e.g. clearing verification state). */
  onNavigate?: () => void
}

/**
 * The cross-page navigation row (Sign up / Sign in / Back to login) — an
 * optional muted prompt followed by an outline {@link ChipLink} pill, matching
 * the landing's secondary chip CTAs. Centralizes the auth nav affordance so the
 * pill chrome is described by props, never restyled per page.
 */
export function AuthNavPrompt({ prompt, href, linkLabel, onNavigate }: AuthNavPromptProps) {
  return (
    <div className='flex items-center justify-center gap-1 text-sm'>
      {prompt && <span className='text-[var(--text-muted)]'>{prompt}</span>}
      <ChipLink href={href} onClick={onNavigate} className='border border-[var(--border-1)]'>
        {linkLabel}
      </ChipLink>
    </div>
  )
}
