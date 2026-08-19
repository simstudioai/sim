'use client'

import { ConsentBanner } from '@/app/_shell/consent/consent-banner'
import { ConsentStoreProvider } from '@/app/_shell/consent/consent-store-provider'

/**
 * The consent banner and the store it reads. Loaded lazily and client-only by
 * {@link ConsentProvider}, which also decides where it may mount.
 */
export function ConsentRuntime() {
  return (
    <ConsentStoreProvider>
      <ConsentBanner />
    </ConsentStoreProvider>
  )
}
