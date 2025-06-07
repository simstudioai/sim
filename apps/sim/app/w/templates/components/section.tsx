'use client'

import { forwardRef, type ReactNode } from 'react'
import { BrowseAllButton } from './shared/browse-all-button'

/**
 * SectionProps interface - defines the properties for the Section component
 * @property {string} title - The heading text for the section
 * @property {string} id - The ID for the section (used for scroll targeting)
 * @property {ReactNode} children - The content to be rendered inside the section
 * @property {boolean} showBrowseAll - Whether to show the Browse All button
 * @property {string} browseAllCategory - Category for the Browse All button
 */
interface SectionProps {
  title: string
  id: string
  children: ReactNode
  showBrowseAll?: boolean
  browseAllCategory?: string
}

/**
 * Section component - Renders a section with a title and content
 * Used to organize different categories of workflows in the templates
 * Implements forwardRef to allow parent components to access the DOM node for scrolling
 */
export const Section = forwardRef<HTMLDivElement, SectionProps>(
  ({ title, id, children, showBrowseAll = false, browseAllCategory }, ref) => {
    return (
      <div ref={ref} id={id} className='mb-12 scroll-mt-14'>
        <div className='mb-6 flex items-center justify-between'>
          <h2 className='font-medium text-lg capitalize'>{title}</h2>
          {showBrowseAll && browseAllCategory && <BrowseAllButton category={browseAllCategory} />}
        </div>
        {children}
      </div>
    )
  }
)

Section.displayName = 'Section'
