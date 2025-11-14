import type { Suggestion, SuggestionGroup } from '@/app/workspace/[workspaceId]/logs/types/search'

export interface FilterDefinition {
  key: string
  label: string
  description: string
  options: Array<{
    value: string
    label: string
    description?: string
  }>
}

export interface WorkflowData {
  id: string
  name: string
  description?: string
}

export interface FolderData {
  id: string
  name: string
}

export const FILTER_DEFINITIONS: FilterDefinition[] = [
  {
    key: 'level',
    label: 'Status',
    description: 'Filter by log level',
    options: [
      { value: 'error', label: 'Error', description: 'Error logs only' },
      { value: 'info', label: 'Info', description: 'Info logs only' },
    ],
  },
  {
    key: 'trigger',
    label: 'Trigger',
    description: 'Filter by trigger type',
    options: [
      { value: 'api', label: 'API', description: 'API-triggered executions' },
      { value: 'manual', label: 'Manual', description: 'Manually triggered executions' },
      { value: 'webhook', label: 'Webhook', description: 'Webhook-triggered executions' },
      { value: 'chat', label: 'Chat', description: 'Chat-triggered executions' },
      { value: 'schedule', label: 'Schedule', description: 'Scheduled executions' },
    ],
  },
  {
    key: 'cost',
    label: 'Cost',
    description: 'Filter by execution cost',
    options: [
      { value: '>0.01', label: 'Over $0.01', description: 'Executions costing more than $0.01' },
      {
        value: '<0.005',
        label: 'Under $0.005',
        description: 'Executions costing less than $0.005',
      },
      { value: '>0.05', label: 'Over $0.05', description: 'Executions costing more than $0.05' },
      { value: '=0', label: 'Free', description: 'Free executions' },
      { value: '>0', label: 'Paid', description: 'Executions with cost' },
    ],
  },
  {
    key: 'date',
    label: 'Date',
    description: 'Filter by date range',
    options: [
      { value: 'today', label: 'Today', description: "Today's logs" },
      { value: 'yesterday', label: 'Yesterday', description: "Yesterday's logs" },
      { value: 'this-week', label: 'This week', description: "This week's logs" },
      { value: 'last-week', label: 'Last week', description: "Last week's logs" },
      { value: 'this-month', label: 'This month', description: "This month's logs" },
    ],
  },
  {
    key: 'duration',
    label: 'Duration',
    description: 'Filter by execution duration',
    options: [
      { value: '>5s', label: 'Over 5s', description: 'Executions longer than 5 seconds' },
      { value: '<1s', label: 'Under 1s', description: 'Executions shorter than 1 second' },
      { value: '>10s', label: 'Over 10s', description: 'Executions longer than 10 seconds' },
      { value: '>30s', label: 'Over 30s', description: 'Executions longer than 30 seconds' },
      { value: '<500ms', label: 'Under 0.5s', description: 'Very fast executions' },
    ],
  },
]

export class SearchSuggestions {
  private workflowsData: WorkflowData[]
  private foldersData: FolderData[]

  constructor(workflowsData: WorkflowData[] = [], foldersData: FolderData[] = []) {
    this.workflowsData = workflowsData
    this.foldersData = foldersData
  }

  updateData(workflowsData: WorkflowData[] = [], foldersData: FolderData[] = []) {
    this.workflowsData = workflowsData
    this.foldersData = foldersData
  }

  /**
   * Get suggestions based ONLY on current input (no cursor position!)
   */
  getSuggestions(input: string): SuggestionGroup | null {
    const trimmed = input.trim()

    // Empty input → show all filter keys
    if (!trimmed) {
      return this.getFilterKeysList()
    }

    // Input ends with ':' → show values for that key
    if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1)
      return this.getFilterValues(key)
    }

    // Input contains ':' → filter value context
    if (trimmed.includes(':')) {
      const [key, partial] = trimmed.split(':')
      return this.getFilterValues(key, partial)
    }

    // Plain text → multi-section results
    return this.getMultiSectionResults(trimmed)
  }

  /**
   * Get filter keys list (empty input state)
   */
  private getFilterKeysList(): SuggestionGroup {
    const suggestions: Suggestion[] = []

    // Add all filter keys
    for (const filter of FILTER_DEFINITIONS) {
      suggestions.push({
        id: `filter-key-${filter.key}`,
        value: `${filter.key}:`,
        label: filter.label,
        description: filter.description,
        category: 'filters',
      })
    }

    // Add workflow and folder keys
    if (this.workflowsData.length > 0) {
      suggestions.push({
        id: 'filter-key-workflow',
        value: 'workflow:',
        label: 'Workflow',
        description: 'Filter by workflow name',
        category: 'filters',
      })
    }

    if (this.foldersData.length > 0) {
      suggestions.push({
        id: 'filter-key-folder',
        value: 'folder:',
        label: 'Folder',
        description: 'Filter by folder name',
        category: 'filters',
      })
    }

    suggestions.push({
      id: 'filter-key-workflowId',
      value: 'workflowId:',
      label: 'Workflow ID',
      description: 'Filter by workflow ID',
      category: 'filters',
    })

    suggestions.push({
      id: 'filter-key-executionId',
      value: 'executionId:',
      label: 'Execution ID',
      description: 'Filter by execution ID',
      category: 'filters',
    })

    return {
      type: 'filter-keys',
      suggestions,
    }
  }

  /**
   * Get filter values for a specific key
   */
  private getFilterValues(key: string, partial = ''): SuggestionGroup | null {
    const filterDef = FILTER_DEFINITIONS.find((f) => f.key === key)

    if (filterDef) {
      const suggestions = filterDef.options
        .filter(
          (opt) =>
            !partial ||
            opt.value.toLowerCase().includes(partial.toLowerCase()) ||
            opt.label.toLowerCase().includes(partial.toLowerCase())
        )
        .map((opt) => ({
          id: `filter-value-${key}-${opt.value}`,
          value: `${key}:${opt.value}`,
          label: opt.label,
          description: opt.description,
          category: key as any,
        }))

      return suggestions.length > 0
        ? {
            type: 'filter-values',
            filterKey: key,
            suggestions,
          }
        : null
    }

    // Workflow filter values
    if (key === 'workflow') {
      const suggestions = this.workflowsData
        .filter((w) => !partial || w.name.toLowerCase().includes(partial.toLowerCase()))
        .slice(0, 8)
        .map((w) => ({
          id: `filter-value-workflow-${w.id}`,
          value: `workflow:"${w.name}"`,
          label: w.name,
          description: w.description,
          category: 'workflow' as const,
        }))

      return suggestions.length > 0
        ? {
            type: 'filter-values',
            filterKey: 'workflow',
            suggestions,
          }
        : null
    }

    // Folder filter values
    if (key === 'folder') {
      const suggestions = this.foldersData
        .filter((f) => !partial || f.name.toLowerCase().includes(partial.toLowerCase()))
        .slice(0, 8)
        .map((f) => ({
          id: `filter-value-folder-${f.id}`,
          value: `folder:"${f.name}"`,
          label: f.name,
          category: 'folder' as const,
        }))

      return suggestions.length > 0
        ? {
            type: 'filter-values',
            filterKey: 'folder',
            suggestions,
          }
        : null
    }

    return null
  }

  /**
   * Get multi-section results for plain text
   */
  private getMultiSectionResults(query: string): SuggestionGroup | null {
    const sections: Array<{ title: string; suggestions: Suggestion[] }> = []
    const allSuggestions: Suggestion[] = []

    // Show all results option
    const showAllSuggestion: Suggestion = {
      id: 'show-all',
      value: query,
      label: `Show all results for "${query}"`,
      category: 'show-all',
    }
    allSuggestions.push(showAllSuggestion)

    // Match filter values (e.g., "info" → "Status: Info")
    const matchingFilterValues = this.getMatchingFilterValues(query)
    if (matchingFilterValues.length > 0) {
      sections.push({
        title: 'SUGGESTED FILTERS',
        suggestions: matchingFilterValues,
      })
      allSuggestions.push(...matchingFilterValues)
    }

    // Match workflows
    const matchingWorkflows = this.getMatchingWorkflows(query)
    if (matchingWorkflows.length > 0) {
      sections.push({
        title: 'WORKFLOWS',
        suggestions: matchingWorkflows,
      })
      allSuggestions.push(...matchingWorkflows)
    }

    // Match folders
    const matchingFolders = this.getMatchingFolders(query)
    if (matchingFolders.length > 0) {
      sections.push({
        title: 'FOLDERS',
        suggestions: matchingFolders,
      })
      allSuggestions.push(...matchingFolders)
    }

    // Add filter keys if no specific matches
    if (
      matchingFilterValues.length === 0 &&
      matchingWorkflows.length === 0 &&
      matchingFolders.length === 0
    ) {
      const filterKeys = this.getFilterKeysList()
      if (filterKeys.suggestions.length > 0) {
        sections.push({
          title: 'SUGGESTED FILTERS',
          suggestions: filterKeys.suggestions.slice(0, 5),
        })
        allSuggestions.push(...filterKeys.suggestions.slice(0, 5))
      }
    }

    return allSuggestions.length > 0
      ? {
          type: 'multi-section',
          suggestions: allSuggestions,
          sections,
        }
      : null
  }

  /**
   * Match filter values across all definitions
   */
  private getMatchingFilterValues(query: string): Suggestion[] {
    if (!query.trim()) return []

    const matches: Suggestion[] = []
    const lowerQuery = query.toLowerCase()

    for (const filterDef of FILTER_DEFINITIONS) {
      for (const option of filterDef.options) {
        if (
          option.value.toLowerCase().includes(lowerQuery) ||
          option.label.toLowerCase().includes(lowerQuery)
        ) {
          matches.push({
            id: `filter-match-${filterDef.key}-${option.value}`,
            value: `${filterDef.key}:${option.value}`,
            label: `${filterDef.label}: ${option.label}`,
            description: option.description,
            category: filterDef.key as any,
          })
        }
      }
    }

    return matches.slice(0, 5)
  }

  /**
   * Match workflows by name/description
   */
  private getMatchingWorkflows(query: string): Suggestion[] {
    if (!query.trim() || this.workflowsData.length === 0) return []

    const lowerQuery = query.toLowerCase()

    const matches = this.workflowsData
      .filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(lowerQuery) ||
          workflow.description?.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => {
        const aName = a.name.toLowerCase()
        const bName = b.name.toLowerCase()

        if (aName === lowerQuery) return -1
        if (bName === lowerQuery) return 1
        if (aName.startsWith(lowerQuery) && !bName.startsWith(lowerQuery)) return -1
        if (bName.startsWith(lowerQuery) && !aName.startsWith(lowerQuery)) return 1
        return aName.localeCompare(bName)
      })
      .slice(0, 8)
      .map((workflow) => ({
        id: `workflow-match-${workflow.id}`,
        value: `workflow:"${workflow.name}"`,
        label: workflow.name,
        description: workflow.description,
        category: 'workflow' as const,
      }))

    return matches
  }

  /**
   * Match folders by name
   */
  private getMatchingFolders(query: string): Suggestion[] {
    if (!query.trim() || this.foldersData.length === 0) return []

    const lowerQuery = query.toLowerCase()

    const matches = this.foldersData
      .filter((folder) => folder.name.toLowerCase().includes(lowerQuery))
      .sort((a, b) => {
        const aName = a.name.toLowerCase()
        const bName = b.name.toLowerCase()

        if (aName === lowerQuery) return -1
        if (bName === lowerQuery) return 1
        if (aName.startsWith(lowerQuery) && !bName.startsWith(lowerQuery)) return -1
        if (bName.startsWith(lowerQuery) && !aName.startsWith(lowerQuery)) return 1
        return aName.localeCompare(bName)
      })
      .slice(0, 8)
      .map((folder) => ({
        id: `folder-match-${folder.id}`,
        value: `folder:"${folder.name}"`,
        label: folder.name,
        category: 'folder' as const,
      }))

    return matches
  }
}
