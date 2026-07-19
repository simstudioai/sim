export const FULLSTACK_DESIGN_STYLES = ['minimal', 'professional', 'playful', 'custom'] as const
export const FULLSTACK_DESIGN_THEMES = ['light', 'dark', 'system'] as const

export type FullstackDesignPreferences = {
  appName?: string
  instructions?: string
  primaryColor?: string
  style?: (typeof FULLSTACK_DESIGN_STYLES)[number]
  theme?: (typeof FULLSTACK_DESIGN_THEMES)[number]
}

export type FullstackWorkflowSeed = {
  source: 'existing_workflow'
  workflowIds: string[]
  projectId?: string
  design: FullstackDesignPreferences
}
