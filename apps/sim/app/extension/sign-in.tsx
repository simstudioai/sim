'use client'

import { Chip, ChipLink } from '@sim/emcn'

export function ExtensionSignIn() {
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
