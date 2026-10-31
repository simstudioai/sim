'use client'

import {
  Chip,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { BrowserNotice } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-notice'
import type { ContinueSignInController } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/use-continue-sign-in'

interface BrowserContinueSignInMenuItemsProps {
  controller: ContinueSignInController
  /** Wraps an action so it runs once the menu has closed. */
  afterClose: (action: () => void) => () => void
}

/** "Continue in Chrome", or a picker when several browser profiles can take the page. */
export function BrowserContinueSignInMenuItems({
  controller,
  afterClose,
}: BrowserContinueSignInMenuItemsProps) {
  const { canContinue, profiles, continueIn } = controller
  if (!canContinue) return null

  return (
    <>
      <DropdownMenuSeparator />
      {profiles.length === 1 ? (
        <DropdownMenuItem onSelect={afterClose(() => void continueIn(profiles[0]))}>
          Continue in {profiles[0].label}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Continue in Browser</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {profiles.map((profile) => (
              <DropdownMenuItem
                key={profile.id}
                onSelect={afterClose(() => void continueIn(profile))}
              >
                {profile.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  )
}

interface BrowserContinueSignInNoticeProps {
  controller: ContinueSignInController
}

/** Asks to bring a pending sign-in back, or suggests continuing on a known sign-in page. */
export function BrowserContinueSignInNotice({ controller }: BrowserContinueSignInNoticeProps) {
  const {
    pending,
    starting,
    importing,
    hintVisible,
    profiles,
    continueIn,
    bringBack,
    cancel,
    dismissHint,
  } = controller

  if (pending) {
    return (
      <BrowserNotice
        message={`Finish signing in to ${pending.site} in ${pending.browserLabel}, then bring the session back. macOS may ask to allow access to ${pending.browserLabel} Safe Storage.`}
        actions={
          <>
            <Chip variant='primary' disabled={importing} onClick={() => void bringBack()}>
              {importing ? 'Bringing back…' : 'Bring session back'}
            </Chip>
            <Chip disabled={importing} onClick={cancel}>
              Cancel
            </Chip>
          </>
        }
      />
    )
  }

  if (!hintVisible) return null
  const [profile] = profiles
  return (
    <BrowserNotice
      message={`Signing in with a passkey? Finish in ${profile.browserLabel} and bring the session back.`}
      actions={
        <>
          <Chip disabled={starting} onClick={() => void continueIn(profile)}>
            Continue in {profile.label}
          </Chip>
          <Chip leftIcon={X} aria-label='Dismiss sign-in hint' onClick={dismissHint} />
        </>
      }
    />
  )
}
