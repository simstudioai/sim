'use client'

import { Button, IconButton } from '@sim/emcn/button'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { InlineNotice } from '@sim/emcn/status'
import type { useContinueSignIn } from '@/platform/lib/data/browser-sign-in'

type ContinueSignIn = ReturnType<typeof useContinueSignIn>

/**
 * The browser menu's "Continue in Chrome", or a picker when several browser profiles can take the
 * page. Empty when no installed browser can continue it.
 */
export function continueSignInActions(
  signIn: ContinueSignIn,
  afterClose: (action: () => void) => () => void
): MenuAction[] {
  const { canContinue, profiles, continueIn } = signIn
  const [first, ...rest] = profiles
  if (!canContinue || !first) return []
  if (rest.length === 0)
    return [
      {
        id: 'continue-sign-in',
        label: `Continue in ${first.label}`,
        separatorBefore: true,
        onSelect: afterClose(() => void continueIn(first)),
      },
    ]
  const [head, ...tail] = profiles.map(
    (profile): MenuAction => ({
      id: `continue-sign-in:${profile.id}`,
      label: profile.label,
      onSelect: afterClose(() => void continueIn(profile)),
    })
  )
  return [
    {
      id: 'continue-sign-in',
      label: 'Continue in Browser',
      separatorBefore: true,
      children: [head, ...tail],
    },
  ]
}

interface ContinueSignInNoticeProps {
  signIn: ContinueSignIn
}

/** Asks to bring a pending sign-in back, or suggests continuing on a known sign-in page. */
export function ContinueSignInNotice({ signIn }: ContinueSignInNoticeProps) {
  const { pending, starting, importing, hintVisible, profiles } = signIn
  if (pending)
    return (
      <InlineNotice
        message={`Finish signing in to ${pending.site} in ${pending.browserLabel}, then bring the session back. macOS may ask to allow access to ${pending.browserLabel} Safe Storage.`}
        action={
          <>
            <Button
              variant='muted'
              size='compact'
              disabled={importing}
              onClick={() => void signIn.bringBack()}
            >
              {importing ? 'Bringing back…' : 'Bring session back'}
            </Button>
            <Button variant='quiet' size='compact' disabled={importing} onClick={signIn.cancel}>
              Cancel
            </Button>
          </>
        }
      />
    )
  const [profile] = profiles
  if (!hintVisible || !profile) return null
  return (
    <InlineNotice
      message={`Signing in with a passkey? Finish in ${profile.browserLabel} and bring the session back.`}
      action={
        <>
          <Button
            variant='muted'
            size='compact'
            disabled={starting}
            onClick={() => void signIn.continueIn(profile)}
          >
            {`Continue in ${profile.label}`}
          </Button>
          <IconButton
            label='Dismiss sign-in hint'
            icon='I105'
            size='compact'
            onClick={signIn.dismissHint}
          />
        </>
      }
    />
  )
}
