'use client'

import { forwardRef, type ReactNode } from 'react'

/**
 * SectionProps interface - defines the properties for the Section component
 * @property {string} title - The heading text for the section
 * @property {string} id - The ID for the section (used for scroll targeting)
 * @property {ReactNode} children - The content to be rendered inside the section
 */
interface SectionProps {
  title: string
  id: string
  children: ReactNode
}

/**
 * Section component - Renders a section with a title and content
 * Used to organize different categories of workflows in the marketplace
 * Implements forwardRef to allow parent components to access the DOM node for scrolling
 */
export const Section = forwardRef<HTMLDivElement, SectionProps>(({ title, id, children }, ref) => {
  return (
    <div ref={ref} id={id} className='mb-12 scroll-mt-14'>
      <h2 className='mb-6 font-medium text-lg capitalize'>{title}</h2>
      {children}
    </div>
  )
})

Section.displayName = 'Section'
