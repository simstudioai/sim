import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AccountSettingsRenderer } from '@/components/settings/account-settings-renderer'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  getAccountSettingsHref,
  getSettingsSectionMeta,
  parseSettingsPathSection,
} from '@/components/settings/navigation'
import { SettingsSectionSkeleton } from '@/components/settings/settings-section-skeleton'
import { getSession } from '@/lib/auth'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { isPlatformAdmin } from '@/lib/permissions/super-user'

interface AccountSettingsSectionPageProps {
  params: Promise<{ section: string }>
}

export async function generateMetadata({
  params,
}: AccountSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: ACCOUNT_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
  })
  const meta = parsed ? getSettingsSectionMeta('account', parsed) : null
  return { title: meta ? `${meta.label} - Account settings` : 'Account settings' }
}

export default async function AccountSettingsSectionPage({
  params,
}: AccountSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: ACCOUNT_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
  })
  if (!parsed) notFound()
  if (parsed === 'billing' && !isBillingEnabled) redirect(getAccountSettingsHref('general'))
  if (parsed === 'admin' || parsed === 'mothership') {
    const isSuperUser = await isPlatformAdmin(session.user.id)
    if (!isSuperUser) notFound()
  }

  /**
   * Sections read URL query params via nuqs (which uses `useSearchParams`
   * internally), so the renderer must sit under a Suspense boundary. It shares the
   * route's loading placeholder, so a section resolving its params looks the same as one
   * whose chunk is still in flight.
   */
  return (
    <Suspense fallback={<SettingsSectionSkeleton />}>
      <AccountSettingsRenderer section={parsed} />
    </Suspense>
  )
}
