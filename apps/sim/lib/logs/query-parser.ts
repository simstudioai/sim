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
          params.level = filter.value as string
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

      case 'execution':
        if (filter.operator === '=' && parsedQuery.textSearch) {
          params.search = `${parsedQuery.textSearch} ${filter.value}`.trim()
        } else if (filter.operator === '=') {
          params.search = filter.value as string
        }
        break

      case 'date':
        if (filter.operator === '=' && filter.value === 'today') {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          params.startDate = today.toISOString()
        } else if (filter.operator === '=' && filter.value === 'yesterday') {
          const yesterday = new Date()
          yesterday.setDate(yesterday.getDate() - 1)
          yesterday.setHours(0, 0, 0, 0)
          params.startDate = yesterday.toISOString()

          const endOfYesterday = new Date(yesterday)
          endOfYesterday.setHours(23, 59, 59, 999)
          params.endDate = endOfYesterday.toISOString()
        }
        break

      case 'cost':
        params[`cost_${filter.operator}_${filter.value}`] = 'true'
        break

      case 'duration':
        params[`duration_${filter.operator}_${filter.value}`] = 'true'
        break
    }
  }

  return params
}
