'use client'

import { createContext, use } from 'react'
import type { NavNode } from '@/lib/content/types'

interface DocsNavigation {
  navigation: NavNode[]
  pathname: string
}

export const DocsNavigationContext = createContext<DocsNavigation | null>(null)

export function useDocsNavigation() {
  const navigation = use(DocsNavigationContext)
  if (!navigation) throw new Error('Documentation navigation requires DocsShell')
  return navigation
}
