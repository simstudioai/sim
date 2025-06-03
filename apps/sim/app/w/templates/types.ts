/**
 * Shared types for the Templates module
 * 
 * This file centralizes all template-related interfaces to avoid duplication
 * and ensure consistency across components.
 */

// Base workflow state interface used across templates
export interface WorkflowState {
  blocks: Record<string, any>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
  loops: Record<string, any>
  parallels: Record<string, any>
}

// Template data interface that supports both current API responses and database schema
export interface TemplateData {
  id: string
  workflowId: string
  name: string
  // Support both legacy API response and database schema
  description?: string // For compatibility with current components
  short_description?: string | null // Database field
  long_description?: string | null // Database field
  authorId?: string
  authorName: string
  views: number
  category: string | null
  price: string
  createdAt: string
  updatedAt: string
  workflowState?: WorkflowState
}

// Legacy interface for backward compatibility with existing components
export interface Workflow {
  id: string
  name: string
  description: string
  author: string
  views: number
  tags: string[]
  thumbnail?: string
  workflowUrl: string
  workflowState?: WorkflowState
  price: string
}

// API response format for template collections
export interface TemplateCollection {
  popular: TemplateData[]
  recent: TemplateData[]
  byCategory: Record<string, TemplateData[]>
}

// Component prop interfaces
export interface TemplateComponentProps {
  template: TemplateData
}

export interface TemplateCardProps extends TemplateComponentProps {
  index?: number
  onHover?: (templateId: string) => void
  onSelect?: (templateId: string) => void
}

// Helper function to get description from template data
export function getTemplateDescription(template: TemplateData): string {
  return template.short_description || template.long_description || ''
} 