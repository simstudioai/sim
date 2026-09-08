import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
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
import { prefetchStandaloneGeneral } from '@/components/settings/prefetch-standalone-general'
import { getSession } from '@/lib/auth'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'

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
  if (section === 'authorized-apps') {
    redirect(`${getAccountSettingsHref('general')}?view=authorized-apps`)
  }
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
   * Sections read URL query params via nuqs, so the renderer must sit under a
   * Suspense boundary. The null fallback preserves the existing chunk-loading UI.
   */
  const content = (
    <Suspense fallback={null}>
      <AccountSettingsRenderer section={parsed} />
    </Suspense>
  )

  if (parsed === 'general') {
    const queryClient = getQueryClient()
    await prefetchStandaloneGeneral(queryClient)

    return <HydrationBoundary state={dehydrate(queryClient)}>{content}</HydrationBoundary>
  }

  return content
}
