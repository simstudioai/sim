'use client'

import type { ReactNode } from 'react'
import { ClientCodeBlockProvider } from 'fumadocs-openapi/ui/base'
import { simShikiFactory } from '@/lib/shiki-factory'

/**
 * Supplies the API reference's client-side code blocks with {@link simShikiFactory}.
 *
 * Replaces the provider `fumadocs-openapi/ui`'s `createAPIPage` wraps pages in, which hardcodes
 * `defaultShikiFactory` — hence importing `createAPIPage` from `ui/base` instead. The factory is
 * imported here rather than passed in as a prop: it carries functions, and RSC props cannot.
 */
export function ApiShikiProvider({ children }: { children: ReactNode }) {
  return <ClientCodeBlockProvider factory={simShikiFactory}>{children}</ClientCodeBlockProvider>
}
