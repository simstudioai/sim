'use client'

import { useState } from 'react'
import { SIM_LINK_DRAFT_PATH } from '@sim/browser-extension-protocol'
import { Chip, ChipLink } from '@sim/emcn'
import { usePathname } from 'next/navigation'
import { preserveLinkDraft } from '@/app/extension/create-link/destination'
import { useHydrated } from '@/hooks/use-hydrated'

function LinkDraftSignIn() {
  const hydrated = useHydrated()
  const [needsSeparateTab, setNeedsSeparateTab] = useState(false)
  const href = `/login?callbackUrl=${encodeURIComponent(SIM_LINK_DRAFT_PATH)}`
  return (
    <main className='flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6 text-center text-[var(--text-body)] text-small'>
      <h1 className='text-lg'>Sign in to create a link</h1>
      {needsSeparateTab ? (
        <>
          <p>Sign in in another tab, then reload this draft.</p>
          <ChipLink href='/login' target='_blank' rel='noopener noreferrer'>
            Sign in
          </ChipLink>
          <Chip onClick={() => window.location.reload()}>Reload draft</Chip>
        </>
      ) : (
        <Chip
          variant='primary'
          disabled={!hydrated}
          onClick={() => {
            if (preserveLinkDraft()) window.location.assign(href)
            else setNeedsSeparateTab(true)
          }}
        >
          Sign in
        </Chip>
      )}
    </main>
  )
}

export function ExtensionSignIn() {
  const pathname = usePathname()
  if (pathname === SIM_LINK_DRAFT_PATH) return <LinkDraftSignIn />
  return (
    <main className='flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6 text-center text-[var(--text-body)] text-small'>
      <h1 className='text-lg'>Sign in to Sim</h1>
      <p className='text-[var(--text-muted)] text-caption'>
        Sign in in a browser tab, then reload this panel.
      </p>
      <ChipLink
        href='/login?callbackUrl=%2Fextension'
        target='_blank'
        rel='noopener noreferrer'
        variant='primary'
      >
        Sign in
      </ChipLink>
      <Chip onClick={() => window.location.reload()}>Reload panel</Chip>
    </main>
  )
}
