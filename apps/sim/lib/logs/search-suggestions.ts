import type { Suggestion, SuggestionGroup } from '@/app/workspace/[workspaceId]/logs/types'

export interface FilterDefinition {
  key: string
  label: string
  description: string
  options: Array<{
    value: string
    label: string
    description?: string
  }>
  acceptsCustomValue?: boolean
  customValueHint?: string
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

export interface TriggerData {
  value: string
  label: string
  color: string
}

/**
 * Generates current date examples for the date filter options.
 */
function getDateExamples() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const firstOfMonth = `${year}-${month}-01`
  const today = `${year}-${month}-${day}`
  const yearMonth = `${year}-${month}`
  return { today, firstOfMonth, year: String(year), yearMonth }
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
    options: (() => {
      const { today, firstOfMonth, year, yearMonth } = getDateExamples()
      return [
        { value: 'today', label: 'Today', description: "Today's logs" },
        { value: 'yesterday', label: 'Yesterday', description: "Yesterday's logs" },
        { value: 'this-week', label: 'This week', description: "This week's logs" },
        { value: 'last-week', label: 'Last week', description: "Last week's logs" },
        { value: 'this-month', label: 'This month', description: "This month's logs" },
        { value: today, label: 'Specific date', description: 'YYYY-MM-DD' },
        { value: yearMonth, label: 'Specific month', description: 'YYYY-MM' },
        { value: year, label: 'Specific year', description: 'YYYY' },
        {
          value: `${firstOfMonth}..${today}`,
          label: 'Date range',
          description: 'YYYY-MM-DD..YYYY-MM-DD',
        },
      ]
    })(),
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
  private triggersData: TriggerData[]

  constructor(
    workflowsData: WorkflowData[] = [],
    foldersData: FolderData[] = [],
    triggersData: TriggerData[] = []
  ) {
    this.workflowsData = workflowsData
    this.foldersData = foldersData
    this.triggersData = triggersData
  }

  updateData(
    workflowsData: WorkflowData[] = [],
    foldersData: FolderData[] = [],
    triggersData: TriggerData[] = []
  ) {
    this.workflowsData = workflowsData
    this.foldersData = foldersData
    this.triggersData = triggersData
  }

  /**
   * Get all triggers from registry data
   */
  private getAllTriggers(): TriggerData[] {
    return this.triggersData
  }

  /**
   * Get suggestions based ONLY on current input (no cursor position!)
   */
  getSuggestions(input: string): SuggestionGroup | null {
    const trimmed = input.trim()

    if (!trimmed) {
      return this.getFilterKeysList()
    }

    if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1)
      return this.getFilterValues(key)
    }

    if (trimmed.includes(':')) {
      const [key, partial] = trimmed.split(':')
      return this.getFilterValues(key, partial)
    }

    return this.getMultiSectionResults(trimmed)
  }

  /**
   * Get filter keys list (empty input state)
   */
  private getFilterKeysList(): SuggestionGroup {
    const suggestions: Suggestion[] = []

    for (const filter of FILTER_DEFINITIONS) {
      suggestions.push({
        id: `filter-key-${filter.key}`,
        value: `${filter.key}:`,
        label: filter.label,
        description: filter.description,
        category: 'filters',
      })
    }

    suggestions.push({
      id: 'filter-key-trigger',
      value: 'trigger:',
      label: 'Trigger',
      description: 'Filter by trigger type',
      category: 'filters',
    })

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
      const suggestions: Suggestion[] = filterDef.options
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
          category: key as Suggestion['category'],
        }))

      // Handle custom date input
      if (key === 'date' && partial) {
        const dateSuggestions = this.getDateSuggestions(partial)
        if (dateSuggestions.length > 0) {
          suggestions.unshift(...dateSuggestions)
        }
      }

      return suggestions.length > 0
        ? {
            type: 'filter-values',
            filterKey: key,
            suggestions,
          }
        : null
    }

    if (key === 'trigger') {
      const allTriggers = this.getAllTriggers()
      const suggestions = allTriggers
        .filter((t) => !partial || t.label.toLowerCase().includes(partial.toLowerCase()))
        .map((t) => ({
          id: `filter-value-trigger-${t.value}`,
          value: `trigger:${t.value}`,
          label: t.label,
          description: `${t.label}-triggered executions`,
          category: 'trigger' as const,
          color: t.color,
        }))

      return suggestions.length > 0
        ? {
            type: 'filter-values',
            filterKey: 'trigger',
            suggestions,
          }
        : null
    }

    if (key === 'workflow') {
      const suggestions = this.workflowsData
        .filter((w) => !partial || w.name.toLowerCase().includes(partial.toLowerCase()))
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

    if (key === 'folder') {
      const suggestions = this.foldersData
        .filter((f) => !partial || f.name.toLowerCase().includes(partial.toLowerCase()))
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

    const showAllSuggestion: Suggestion = {
      id: 'show-all',
      value: query,
      label: `Show all results for "${query}"`,
      category: 'show-all',
    }
    allSuggestions.push(showAllSuggestion)

    const matchingFilterValues = this.getMatchingFilterValues(query)
    if (matchingFilterValues.length > 0) {
      sections.push({
        title: 'SUGGESTED FILTERS',
        suggestions: matchingFilterValues,
      })
      allSuggestions.push(...matchingFilterValues)
    }

    const matchingTriggers = this.getMatchingTriggers(query)
    if (matchingTriggers.length > 0) {
      sections.push({
        title: 'TRIGGERS',
        suggestions: matchingTriggers,
      })
      allSuggestions.push(...matchingTriggers)
    }

    const matchingWorkflows = this.getMatchingWorkflows(query)
    if (matchingWorkflows.length > 0) {
      sections.push({
        title: 'WORKFLOWS',
        suggestions: matchingWorkflows,
      })
      allSuggestions.push(...matchingWorkflows)
    }

    const matchingFolders = this.getMatchingFolders(query)
    if (matchingFolders.length > 0) {
      sections.push({
        title: 'FOLDERS',
        suggestions: matchingFolders,
      })
      allSuggestions.push(...matchingFolders)
    }

    if (
      matchingFilterValues.length === 0 &&
      matchingTriggers.length === 0 &&
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
   * Get suggestions for custom date input
   */
  private getDateSuggestions(partial: string): Suggestion[] {
    const suggestions: Suggestion[] = []

    // Pattern for year only: YYYY
    const yearPattern = /^\d{4}$/
    // Pattern for month only: YYYY-MM
    const monthPattern = /^\d{4}-\d{2}$/
    // Pattern for full date: YYYY-MM-DD
    const fullDatePattern = /^\d{4}-\d{2}-\d{2}$/
    // Pattern for partial date being typed
    const partialDatePattern = /^\d{4}(-\d{0,2})?(-\d{0,2})?$/
    // Pattern for date range: YYYY-MM-DD..YYYY-MM-DD (complete or partial)
    const rangePattern = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
    const partialRangePattern = /^(\d{4}-\d{2}-\d{2})\.\.?$/

    // Check if it's a complete date range
    if (rangePattern.test(partial)) {
      const [startDate, endDate] = partial.split('..')
      suggestions.push({
        id: `date-range-${partial}`,
        value: `date:${partial}`,
        label: `${this.formatDateLabel(startDate)} to ${this.formatDateLabel(endDate)}`,
        description: 'Custom date range',
        category: 'date' as any,
      })
      return suggestions
    }

    // Check if it's a partial date range (has ..)
    if (partialRangePattern.test(partial)) {
      const startDate = partial.replace(/\.+$/, '')
      suggestions.push({
        id: `date-range-hint-${partial}`,
        value: `date:${startDate}..`,
        label: `${this.formatDateLabel(startDate)} to ...`,
        description: 'Type end date (YYYY-MM-DD)',
        category: 'date' as any,
      })
      return suggestions
    }

    // Check if it's a year only (YYYY)
    if (yearPattern.test(partial)) {
      suggestions.push({
        id: `date-year-${partial}`,
        value: `date:${partial}`,
        label: `Year ${partial}`,
        description: 'All logs from this year',
        category: 'date' as any,
      })
      return suggestions
    }

    // Check if it's a month only (YYYY-MM)
    if (monthPattern.test(partial)) {
      const [year, month] = partial.split('-')
      const monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ]
      const monthName = monthNames[Number.parseInt(month, 10) - 1] || month
      suggestions.push({
        id: `date-month-${partial}`,
        value: `date:${partial}`,
        label: `${monthName} ${year}`,
        description: 'All logs from this month',
        category: 'date' as any,
      })
      return suggestions
    }

    // Check if it's a complete single date
    if (fullDatePattern.test(partial)) {
      const date = new Date(partial)
      if (!Number.isNaN(date.getTime())) {
        suggestions.push({
          id: `date-single-${partial}`,
          value: `date:${partial}`,
          label: this.formatDateLabel(partial),
          description: 'Single date',
          category: 'date' as any,
        })
        // Also suggest starting a range
        suggestions.push({
          id: `date-range-start-${partial}`,
          value: `date:${partial}..`,
          label: `${this.formatDateLabel(partial)} to ...`,
          description: 'Start a date range',
          category: 'date' as any,
        })
      }
      return suggestions
    }

    // Check if user is typing a date pattern
    if (partialDatePattern.test(partial) && partial.length >= 4) {
      suggestions.push({
        id: 'date-custom-hint',
        value: `date:${partial}`,
        label: partial,
        description: 'Continue typing: YYYY, YYYY-MM, or YYYY-MM-DD',
        category: 'date' as any,
      })
    }

    return suggestions
  }

  /**
   * Format a date string for display
   */
  private formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
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
   * Match triggers by label (core + integrations)
   */
  private getMatchingTriggers(query: string): Suggestion[] {
    if (!query.trim()) return []

    const lowerQuery = query.toLowerCase()
    const allTriggers = this.getAllTriggers()

    const matches = allTriggers
      .filter((trigger) => trigger.label.toLowerCase().includes(lowerQuery))
      .sort((a, b) => {
        const aLabel = a.label.toLowerCase()
        const bLabel = b.label.toLowerCase()

        if (aLabel === lowerQuery) return -1
        if (bLabel === lowerQuery) return 1
        if (aLabel.startsWith(lowerQuery) && !bLabel.startsWith(lowerQuery)) return -1
        if (bLabel.startsWith(lowerQuery) && !aLabel.startsWith(lowerQuery)) return 1
        return aLabel.localeCompare(bLabel)
      })
      .slice(0, 8)
      .map((trigger) => ({
        id: `trigger-match-${trigger.value}`,
        value: `trigger:${trigger.value}`,
        label: trigger.label,
        description: `${trigger.label}-triggered executions`,
        category: 'trigger' as const,
        color: trigger.color,
      }))

    return matches
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
