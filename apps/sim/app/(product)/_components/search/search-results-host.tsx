'use client'

import { type ComponentType, createContext, useContext } from 'react'
import type { PlatformResource } from '@/platform/lib/data/models/chat'

type SearchTab = ComponentType<{ resource: PlatformResource }>

const Host = createContext<SearchTab | null>(null)
/** Live chats supply the tab's reader; fixture transcripts open none. */
export const SearchTabProvider = Host.Provider

export function SearchResultsPanel({ resource }: { resource: PlatformResource }) {
  const Tab = useContext(Host)
  return Tab ? <Tab resource={resource} /> : null
}
