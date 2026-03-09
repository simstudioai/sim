/**
 * Query language parser for logs search
 *
 * Supports syntax like:
 * level:error workflow:"my-workflow" trigger:api cost:>0.005 date:today
 */

export interface ParsedFilter {
  field: string
  operator: '=' | '>' | '<' | '>=' | '<=' | '!='
  value: string | number | boolean
  originalValue: string
}

export interface ParsedQuery {
  filters: ParsedFilter[]
  textSearch: string // Any remaining text not in field:value format
}

const FILTER_FIELDS = {
  level: 'string',
  status: 'string', // alias for level
  workflow: 'string',
  trigger: 'string',
  execution: 'string',
  executionId: 'string',
  workflowId: 'string',
  id: 'string',
  cost: 'number',
  duration: 'number',
  date: 'date',
  folder: 'string',
} as const

type FilterField = keyof typeof FILTER_FIELDS

/**
 * Parse a search query string into structured filters and text search
 */
export function parseQuery(query: string): ParsedQuery {
  const filters: ParsedFilter[] = []
  const tokens: string[] = []

  const filterRegex = /(\w+):((?:[><!]=?|=)?(?:"[^"]*"|[^\s]+))/g

  let lastIndex = 0
  let match

  while ((match = filterRegex.exec(query)) !== null) {
    const [fullMatch, field, valueWithOperator] = match

    const beforeText = query.slice(lastIndex, match.index).trim()
    if (beforeText) {
      tokens.push(beforeText)
    }

    const parsedFilter = parseFilter(field, valueWithOperator)
    if (parsedFilter) {
      filters.push(parsedFilter)
    } else {
      tokens.push(fullMatch)
    }

    lastIndex = match.index + fullMatch.length
  }

  const remainingText = query.slice(lastIndex).trim()
  if (remainingText) {
    tokens.push(remainingText)
  }

  return {
    filters,
    textSearch: tokens.join(' ').trim(),
  }
}

/**
 * Parse a single field:value filter
 */
function parseFilter(field: string, valueWithOperator: string): ParsedFilter | null {
  if (!(field in FILTER_FIELDS)) {
    return null
  }

  const filterField = field as FilterField
  const fieldType = FILTER_FIELDS[filterField]

  let operator: ParsedFilter['operator'] = '='
  let value = valueWithOperator

  if (value.startsWith('>=')) {
    operator = '>='
    value = value.slice(2)
  } else if (value.startsWith('<=')) {
    operator = '<='
    value = value.slice(2)
  } else if (value.startsWith('!=')) {
    operator = '!='
    value = value.slice(2)
  } else if (value.startsWith('>')) {
    operator = '>'
    value = value.slice(1)
  } else if (value.startsWith('<')) {
    operator = '<'
    value = value.slice(1)
  } else if (value.startsWith('=')) {
    operator = '='
    value = value.slice(1)
  }

  const originalValue = value
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
  }

  let parsedValue: string | number | boolean = value

  if (fieldType === 'number') {
    if (field === 'duration' && value.endsWith('ms')) {
      parsedValue = Number.parseFloat(value.slice(0, -2))
    } else if (field === 'duration' && value.endsWith('s')) {
      parsedValue = Number.parseFloat(value.slice(0, -1)) * 1000 // Convert to ms
    } else {
      parsedValue = Number.parseFloat(value)
    }

    if (Number.isNaN(parsedValue)) {
      return null
    }
  }

  return {
    field: filterField,
    operator,
    value: parsedValue,
    originalValue,
  }
}

/**
 * Convert parsed query back to URL parameters for the logs API
 */
export function queryToApiParams(parsedQuery: ParsedQuery): Record<string, string> {
  const params: Record<string, string> = {}

  if (parsedQuery.textSearch) {
    params.search = parsedQuery.textSearch
  }

  for (const filter of parsedQuery.filters) {
    switch (filter.field) {
      case 'level':
      case 'status':
        if (filter.operator === '=') {
          const existing = params.level ? params.level.split(',') : []
          existing.push(filter.value as string)
          params.level = existing.join(',')
        }
        break

      case 'trigger':
        if (filter.operator === '=') {
          const existing = params.triggers ? params.triggers.split(',') : []
          existing.push(filter.value as string)
          params.triggers = existing.join(',')
        }
        break

      case 'workflow':
        if (filter.operator === '=') {
          params.workflowName = filter.value as string
        }
        break

      case 'folder':
        if (filter.operator === '=') {
          params.folderName = filter.value as string
        }
        break

      case 'execution':
        if (filter.operator === '=' && parsedQuery.textSearch) {
          params.search = `${parsedQuery.textSearch} ${filter.value}`.trim()
        } else if (filter.operator === '=') {
          params.search = filter.value as string
        }
        break

      case 'workflowId':
        if (filter.operator === '=') {
          params.workflowIds = String(filter.value)
        }
        break

      case 'executionId':
        if (filter.operator === '=') {
          params.executionId = String(filter.value)
        }
        break

      case 'date':
        if (filter.operator === '=') {
          const dateValue = String(filter.value)

          // Handle range syntax: date:2024-01-01..2024-01-15
          if (dateValue.includes('..')) {
            const [startStr, endStr] = dateValue.split('..')
            if (startStr && /^\d{4}-\d{2}-\d{2}$/.test(startStr)) {
              const [year, month, day] = startStr.split('-').map(Number)
              const startDate = new Date(year, month - 1, day, 0, 0, 0, 0)
              params.startDate = startDate.toISOString()
            }
            if (endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
              const [year, month, day] = endStr.split('-').map(Number)
              const endDate = new Date(year, month - 1, day, 23, 59, 59, 999)
              params.endDate = endDate.toISOString()
            }
          } else if (dateValue === 'today') {
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            params.startDate = today.toISOString()
          } else if (dateValue === 'yesterday') {
            const yesterday = new Date()
            yesterday.setDate(yesterday.getDate() - 1)
            yesterday.setHours(0, 0, 0, 0)
            params.startDate = yesterday.toISOString()

            const endOfYesterday = new Date(yesterday)
            endOfYesterday.setHours(23, 59, 59, 999)
            params.endDate = endOfYesterday.toISOString()
          } else if (dateValue === 'this-week') {
            const now = new Date()
            const dayOfWeek = now.getDay()
            const startOfWeek = new Date(now)
            startOfWeek.setDate(now.getDate() - dayOfWeek)
            startOfWeek.setHours(0, 0, 0, 0)
            params.startDate = startOfWeek.toISOString()
          } else if (dateValue === 'last-week') {
            const now = new Date()
            const dayOfWeek = now.getDay()
            const startOfThisWeek = new Date(now)
            startOfThisWeek.setDate(now.getDate() - dayOfWeek)
            startOfThisWeek.setHours(0, 0, 0, 0)

            const startOfLastWeek = new Date(startOfThisWeek)
            startOfLastWeek.setDate(startOfLastWeek.getDate() - 7)
            params.startDate = startOfLastWeek.toISOString()

            const endOfLastWeek = new Date(startOfThisWeek)
            endOfLastWeek.setMilliseconds(-1)
            params.endDate = endOfLastWeek.toISOString()
          } else if (dateValue === 'this-month') {
            const now = new Date()
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            startOfMonth.setHours(0, 0, 0, 0)
            params.startDate = startOfMonth.toISOString()
          } else if (/^\d{4}$/.test(dateValue)) {
            // Year only: YYYY (e.g., 2024)
            const year = Number.parseInt(dateValue, 10)
            const startOfYear = new Date(year, 0, 1)
            startOfYear.setHours(0, 0, 0, 0)
            params.startDate = startOfYear.toISOString()

            const endOfYear = new Date(year, 11, 31)
            endOfYear.setHours(23, 59, 59, 999)
            params.endDate = endOfYear.toISOString()
          } else if (/^\d{4}-\d{2}$/.test(dateValue)) {
            // Month only: YYYY-MM (e.g., 2024-12)
            const [year, month] = dateValue.split('-').map(Number)
            const startOfMonth = new Date(year, month - 1, 1)
            startOfMonth.setHours(0, 0, 0, 0)
            params.startDate = startOfMonth.toISOString()

            const endOfMonth = new Date(year, month, 0) // Day 0 of next month = last day of this month
            endOfMonth.setHours(23, 59, 59, 999)
            params.endDate = endOfMonth.toISOString()
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
            // Parse as a single date (YYYY-MM-DD) using local timezone
            const [year, month, day] = dateValue.split('-').map(Number)
            const startDate = new Date(year, month - 1, day, 0, 0, 0, 0)
            params.startDate = startDate.toISOString()

            const endDate = new Date(year, month - 1, day, 23, 59, 59, 999)
            params.endDate = endDate.toISOString()
          }
        }
        break

      case 'cost':
        params.costOperator = filter.operator
        params.costValue = String(filter.value)
        break

      case 'duration':
        params.durationOperator = filter.operator
        params.durationValue = String(filter.value)
        break
    }
  }

  return params
}
