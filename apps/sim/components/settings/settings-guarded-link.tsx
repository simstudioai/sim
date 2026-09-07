'use client'

import type { ComponentProps } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface SettingsGuardedLinkProps
  extends Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> {
  href: string
  onNavigate?: () => void
}

/** Preserves settings drafts when navigating through menus outside the settings sidebar. */
export function SettingsGuardedLink({ href, onNavigate, ...props }: SettingsGuardedLinkProps) {
  const router = useRouter()

  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
        if (isDirty || navigationBlocked) {
          event.preventDefault()
          requestLeave(() => router.push(href))
        }
        onNavigate?.()
      }}
    />
  )
}
