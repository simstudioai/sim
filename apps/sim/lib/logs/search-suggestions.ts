import type {
  Suggestion,
  SuggestionGroup,
} from '@/app/workspace/[workspaceId]/logs/hooks/use-autocomplete'

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

interface QueryContext {
  type: 'initial' | 'filter-key-partial' | 'filter-value-context' | 'text-search'
  filterKey?: string
  partialInput?: string
  startPosition?: number
  endPosition?: number
}

export class SearchSuggestions {
  private availableWorkflows: string[]
  private availableFolders: string[]

  constructor(availableWorkflows: string[] = [], availableFolders: string[] = []) {
    this.availableWorkflows = availableWorkflows
    this.availableFolders = availableFolders
  }

  updateAvailableData(workflows: string[] = [], folders: string[] = []) {
    this.availableWorkflows = workflows
    this.availableFolders = folders
  }

  /**
   * Check if a filter value is complete (matches a valid option)
   */
  private isCompleteFilterValue(filterKey: string, value: string): boolean {
    const filterDef = FILTER_DEFINITIONS.find((f) => f.key === filterKey)
    if (filterDef) {
      return filterDef.options.some((option) => option.value === value)
    }

    // For workflow and folder filters, any quoted value is considered complete
    if (filterKey === 'workflow' || filterKey === 'folder') {
      return value.startsWith('"') && value.endsWith('"') && value.length > 2
    }

    return false
  }

  /**
   * Analyze the current input context to determine what suggestions to show.
   */
  private analyzeContext(input: string, cursorPosition: number): QueryContext {
    const textBeforeCursor = input.slice(0, cursorPosition)

    if (textBeforeCursor === '' || textBeforeCursor.endsWith(' ')) {
      return { type: 'initial' }
    }

    // Check for filter value context (must be after a space or at start, and not empty value)
    const filterValueMatch = textBeforeCursor.match(/(?:^|\s)(\w+):([\w"<>=!]*)$/)
    if (filterValueMatch && filterValueMatch[2].length > 0 && !filterValueMatch[2].includes(' ')) {
      const filterKey = filterValueMatch[1]
      const filterValue = filterValueMatch[2]

      // If the filter value is complete, treat as ready for next filter
      if (this.isCompleteFilterValue(filterKey, filterValue)) {
        return { type: 'initial' }
      }

      // Otherwise, treat as partial value needing completion
      return {
        type: 'filter-value-context',
        filterKey,
        partialInput: filterValue,
        startPosition:
          filterValueMatch.index! +
          (filterValueMatch[0].startsWith(' ') ? 1 : 0) +
          filterKey.length +
          1,
        endPosition: cursorPosition,
      }
    }

    // Check for empty filter key (just "key:" with no value)
    const emptyFilterMatch = textBeforeCursor.match(/(?:^|\s)(\w+):$/)
    if (emptyFilterMatch) {
      return { type: 'initial' } // Treat as initial to show filter value suggestions
    }

    const filterKeyMatch = textBeforeCursor.match(/(?:^|\s)(\w+):?$/)
    if (filterKeyMatch && !filterKeyMatch[0].includes(':')) {
      return {
        type: 'filter-key-partial',
        partialInput: filterKeyMatch[1],
        startPosition: filterKeyMatch.index! + (filterKeyMatch[0].startsWith(' ') ? 1 : 0),
        endPosition: cursorPosition,
      }
    }

    return { type: 'text-search' }
  }

  /**
   * Get filter key suggestions
   */
  private getFilterKeySuggestions(partialInput?: string): Suggestion[] {
    const suggestions: Suggestion[] = []

    for (const filter of FILTER_DEFINITIONS) {
      const matchesPartial =
        !partialInput ||
        filter.key.toLowerCase().startsWith(partialInput.toLowerCase()) ||
        filter.label.toLowerCase().startsWith(partialInput.toLowerCase())

      if (matchesPartial) {
        suggestions.push({
          id: `filter-key-${filter.key}`,
          value: `${filter.key}:`,
          label: filter.label,
          description: filter.description,
          category: 'filters',
        })
      }
    }

    if (this.availableWorkflows.length > 0) {
      const matchesWorkflow =
        !partialInput ||
        'workflow'.startsWith(partialInput.toLowerCase()) ||
        'workflows'.startsWith(partialInput.toLowerCase())

      if (matchesWorkflow) {
        suggestions.push({
          id: 'filter-key-workflow',
          value: 'workflow:',
          label: 'Workflow',
          description: 'Filter by workflow name',
          category: 'filters',
        })
      }
    }

    if (this.availableFolders.length > 0) {
      const matchesFolder =
        !partialInput ||
        'folder'.startsWith(partialInput.toLowerCase()) ||
        'folders'.startsWith(partialInput.toLowerCase())

      if (matchesFolder) {
        suggestions.push({
          id: 'filter-key-folder',
          value: 'folder:',
          label: 'Folder',
          description: 'Filter by folder name',
          category: 'filters',
        })
      }
    }

    return suggestions
  }

  /**
   * Get filter value suggestions for a specific filter key
   */
  private getFilterValueSuggestions(filterKey: string, partialInput = ''): Suggestion[] {
    const suggestions: Suggestion[] = []

    const filterDef = FILTER_DEFINITIONS.find((f) => f.key === filterKey)
    if (filterDef) {
      for (const option of filterDef.options) {
        const matchesPartial =
          !partialInput ||
          option.value.toLowerCase().includes(partialInput.toLowerCase()) ||
          option.label.toLowerCase().includes(partialInput.toLowerCase())

        if (matchesPartial) {
          suggestions.push({
            id: `filter-value-${filterKey}-${option.value}`,
            value: option.value,
            label: option.label,
            description: option.description,
            category: filterKey,
          })
        }
      }
      return suggestions
    }

    if (filterKey === 'workflow') {
      for (const workflow of this.availableWorkflows) {
        const matchesPartial =
          !partialInput || workflow.toLowerCase().includes(partialInput.toLowerCase())

        if (matchesPartial) {
          suggestions.push({
            id: `filter-value-workflow-${workflow}`,
            value: `"${workflow}"`,
            label: workflow,
            description: 'Workflow name',
            category: 'workflow',
          })
        }
      }
      return suggestions.slice(0, 8)
    }

    if (filterKey === 'folder') {
      for (const folder of this.availableFolders) {
        const matchesPartial =
          !partialInput || folder.toLowerCase().includes(partialInput.toLowerCase())

        if (matchesPartial) {
          suggestions.push({
            id: `filter-value-folder-${folder}`,
            value: `"${folder}"`,
            label: folder,
            description: 'Folder name',
            category: 'folder',
          })
        }
      }
      return suggestions.slice(0, 8)
    }

    return suggestions
  }

  /**
   * Get suggestions based on current input and cursor position
   */
  getSuggestions(input: string, cursorPosition: number): SuggestionGroup | null {
    const context = this.analyzeContext(input, cursorPosition)

    // Special case: check if we're at "key:" position for filter values
    const textBeforeCursor = input.slice(0, cursorPosition)
    const emptyFilterMatch = textBeforeCursor.match(/(?:^|\s)(\w+):$/)
    if (emptyFilterMatch) {
      const filterKey = emptyFilterMatch[1]
      const filterValueSuggestions = this.getFilterValueSuggestions(filterKey, '')
      return filterValueSuggestions.length > 0
        ? {
            type: 'filter-values',
            filterKey,
            suggestions: filterValueSuggestions,
          }
        : null
    }

    switch (context.type) {
      case 'initial':
      case 'filter-key-partial': {
        const filterKeySuggestions = this.getFilterKeySuggestions(context.partialInput)
        return filterKeySuggestions.length > 0
          ? {
              type: 'filter-keys',
              suggestions: filterKeySuggestions,
            }
          : null
      }

      case 'filter-value-context': {
        if (!context.filterKey) return null
        const filterValueSuggestions = this.getFilterValueSuggestions(
          context.filterKey,
          context.partialInput
        )
        return filterValueSuggestions.length > 0
          ? {
              type: 'filter-values',
              filterKey: context.filterKey,
              suggestions: filterValueSuggestions,
            }
          : null
      }
      default:
        return null
    }
  }

  /**
   * Generate preview text for a suggestion - SIMPLE APPROACH
   * Show suggestion at the end of input, with proper spacing logic
   */
  generatePreview(suggestion: Suggestion, currentValue: string, cursorPosition: number): string {
    // If input is empty, just show the suggestion
    if (!currentValue.trim()) {
      return suggestion.value
    }

    // Check if we're doing a partial replacement (like "lev" -> "level:")
    const context = this.analyzeContext(currentValue, cursorPosition)

    if (
      context.type === 'filter-key-partial' &&
      context.startPosition !== undefined &&
      context.endPosition !== undefined
    ) {
      // Replace partial text: "lev" -> "level:"
      const before = currentValue.slice(0, context.startPosition)
      const after = currentValue.slice(context.endPosition)
      return `${before}${suggestion.value}${after}`
    }

    if (
      context.type === 'filter-value-context' &&
      context.startPosition !== undefined &&
      context.endPosition !== undefined
    ) {
      // Replace partial filter value: "level:err" -> "level:error"
      const before = currentValue.slice(0, context.startPosition)
      const after = currentValue.slice(context.endPosition)
      return `${before}${suggestion.value}${after}`
    }

    // For all other cases, append at the end with smart spacing:
    let result = currentValue

    if (currentValue.endsWith(':')) {
      // Direct append for filter values: "level:" + "error" = "level:error"
      result += suggestion.value
    } else if (currentValue.endsWith(' ')) {
      // Already has space, direct append: "level:error " + "trigger:" = "level:error trigger:"
      result += suggestion.value
    } else {
      // Need space: "level:error" + " " + "trigger:" = "level:error trigger:"
      result += ` ${suggestion.value}`
    }

    return result
  }

  /**
   * Validate if a query is complete and should trigger backend calls
   */
  validateQuery(query: string): boolean {
    const incompleteFilterMatch = query.match(/(\w+):$/)
    if (incompleteFilterMatch) {
      return false
    }

    const openQuotes = (query.match(/"/g) || []).length
    if (openQuotes % 2 !== 0) {
      return false
    }

    return true
  }
}
