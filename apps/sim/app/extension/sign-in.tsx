'use client'

import { useEffect, useState } from 'react'
import { SIM_LINK_DRAFT_PATH } from '@sim/browser-extension-protocol'
import { Chip, ChipLink } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { preserveLinkDraft } from '@/app/extension/create-link/destination'
import { refreshSessionQuery } from '@/hooks/queries/session'
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
          <p>Sign in, then return here and reload the draft.</p>
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

interface ExtensionSignInProps {
  expectedUserId?: string
}

function PanelSignIn({ expectedUserId }: ExtensionSignInProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let checking = false
    let checkAgain = false
    const resume = async (returning = false) => {
      if (document.visibilityState === 'hidden') return
      if (checking) {
        checkAgain = true
        return
      }
      checking = true
      try {
        const session = await refreshSessionQuery(queryClient)
        if (active) {
          setFailed(false)
          if (session?.user) {
            if (!expectedUserId) router.refresh()
            else if (returning || session.user.id !== expectedUserId) window.location.reload()
          }
        }
      } catch {
        if (active) setFailed(true)
      } finally {
        checking = false
        if (active && checkAgain) {
          checkAgain = false
          void resume(true)
        }
      }
    }
    const check = () => void resume(true)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    void resume()
    return () => {
      active = false
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [expectedUserId, queryClient, router])
  return (
    <main className='flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6 text-center text-[var(--text-body)] text-small'>
      <h1 className='text-lg'>Sign in to Sim</h1>
      <ChipLink
        href='/login?callbackUrl=%2Fextension'
        target='_blank'
        rel='noopener noreferrer'
        variant='primary'
      >
        Sign in
      </ChipLink>
      <Chip onClick={() => window.location.reload()}>{failed ? 'Try again' : 'Refresh'}</Chip>
    </main>
  )
}

export function ExtensionSignIn({ expectedUserId }: ExtensionSignInProps) {
  const pathname = usePathname()
  return pathname === SIM_LINK_DRAFT_PATH ? (
    <LinkDraftSignIn />
  ) : (
    <PanelSignIn expectedUserId={expectedUserId} />
  )
}
