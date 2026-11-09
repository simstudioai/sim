'use client'

import type { ReactNode } from 'react'
import { ComposerHostProvider } from '@/app/(product)/_components/session/composer-host'
import { LIVE_COMPOSER_HOST } from '@/platform/lib/data/chat-composer'

export function LiveComposerHost({ children }: { children: ReactNode }) {
  return <ComposerHostProvider host={LIVE_COMPOSER_HOST}>{children}</ComposerHostProvider>
}
