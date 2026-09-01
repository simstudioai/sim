import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getSelfHostSettingsHref,
  getSettingsSectionMeta,
  parseSettingsPathSection,
  SELFHOST_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import { prefetchStandaloneGeneral } from '@/components/settings/prefetch-standalone-general'
import { SelfHostSettingsRenderer } from '@/components/settings/selfhost-settings-renderer'
import { getSession } from '@/lib/auth'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'

interface SelfHostSettingsSectionPageProps {
  params: Promise<{ section: string }>
}

export async function generateMetadata({
  params,
}: SelfHostSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: SELFHOST_SETTINGS_ITEMS,
    defaultSection: null,
  })
  const meta = parsed ? getSettingsSectionMeta('selfhost', parsed) : null
  return { title: meta ? `${meta.label} - Self-host settings` : 'Self-host settings' }
}

export default async function SelfHostSettingsSectionPage({
  params,
}: SelfHostSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: SELFHOST_SETTINGS_ITEMS,
    defaultSection: null,
  })
  if (!parsed) notFound()
  if (parsed === 'billing' && !isBillingEnabled) redirect(getSelfHostSettingsHref('general'))
  if (parsed === 'chat-keys' && !isHosted) redirect(getSelfHostSettingsHref('general'))

  /**
   * Sections read URL query params via nuqs, so the renderer must sit under a
   * Suspense boundary. The null fallback preserves the existing chunk-loading UI.
   */
  const content = (
    <Suspense fallback={null}>
      <SelfHostSettingsRenderer section={parsed} />
    </Suspense>
  )

  if (parsed === 'general') {
    const queryClient = getQueryClient()
    await prefetchStandaloneGeneral(queryClient)

    return <HydrationBoundary state={dehydrate(queryClient)}>{content}</HydrationBoundary>
  }

  return content
}
