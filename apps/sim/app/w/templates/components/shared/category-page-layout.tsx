'use client'

import type { ReactNode } from 'react'
import { useSidebarStore } from '@/stores/sidebar/store'
import { TemplatesHeader } from '../control-bar/control-bar'
import { ErrorMessage } from '../error-message'

interface CategoryPageLayoutProps {
  children: ReactNode
  searchQuery: string
  setSearchQuery: (query: string) => void
  activeSection: string | null
  scrollToSection: (sectionId: string) => void
  onCategoryFilter: (categories: string[] | null) => void
  error?: string | null
  mainCategory: string
}

export function CategoryPageLayout({
  children,
  searchQuery,
  setSearchQuery,
  activeSection,
  scrollToSection,
  onCategoryFilter,
  error,
  mainCategory,
}: CategoryPageLayoutProps) {
  const { mode, isExpanded } = useSidebarStore()

  // Calculate if sidebar is collapsed based on mode and state
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  return (
    <div
      className={`flex h-[100vh] w-full max-w-[100vw] flex-col overflow-x-hidden transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      {/* Templates Header */}
      <TemplatesHeader
        setSearchQuery={setSearchQuery}
        activeSection={activeSection}
        scrollToSection={scrollToSection}
        onCategoryFilter={onCategoryFilter}
        currentCategory={mainCategory}
      />

      {/* Main content */}
      <div className='flex-1 overflow-y-auto px-6 py-6 pb-16'>
        {/* Error message */}
        <ErrorMessage message={error || null} />

        {children}
      </div>
    </div>
  )
}
