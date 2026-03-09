export interface Suggestion {
  id: string
  value: string
  label: string
  description?: string
  color?: string
  category?:
    | 'filters'
    | 'level'
    | 'trigger'
    | 'cost'
    | 'date'
    | 'duration'
    | 'workflow'
    | 'folder'
    | 'workflowId'
    | 'executionId'
    | 'show-all'
}

export interface SuggestionSection {
  title: string
  suggestions: Suggestion[]
}

export interface SuggestionGroup {
  type: 'filter-keys' | 'filter-values' | 'multi-section'
  filterKey?: string
  suggestions: Suggestion[]
  sections?: SuggestionSection[]
}
