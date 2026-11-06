'use client'

import dynamic from 'next/dynamic'
import type { SettingsFixtureProviderProps } from '@/platform/fixtures/settings/provider'

/** Only the browser owns the fixture query client, drafts and intercepted requests. */
export const BrowserSettings = dynamic<SettingsFixtureProviderProps>(
  () =>
    import('@/platform/fixtures/settings/provider').then(
      ({ SettingsFixtureProvider }) => SettingsFixtureProvider
    ),
  { ssr: false }
)
