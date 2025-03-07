'use client'

import { ReactNode } from 'react'
import { motion } from 'framer-motion'

/**
 * SectionProps interface - defines the properties for the Section component
 * @property {string} title - The heading text for the section
 * @property {number} count - Optional count of items in the section (not currently used)
 * @property {ReactNode} children - The content to be rendered inside the section
 */
interface SectionProps {
  title: string
  count?: number
  children: ReactNode
}

/**
 * Section component - Renders a section with a title and content
 * Used to organize different categories of workflows in the marketplace
 */
export function Section({ title, count, children }: SectionProps) {
  return (
    <div className="mb-12">
      <h2 className="text-lg font-medium mb-6">{title}</h2>
      {children}
    </div>
  )
}
