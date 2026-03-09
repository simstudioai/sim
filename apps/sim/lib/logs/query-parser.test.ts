/**
 * Tests for query language parser for logs search
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'

describe('parseQuery', () => {
  describe('empty and whitespace input', () => {
    it.concurrent('should handle empty string', () => {
      const result = parseQuery('')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('')
    })

    it.concurrent('should handle whitespace only', () => {
      const result = parseQuery('   ')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('')
    })
  })

  describe('simple text search', () => {
    it.concurrent('should parse plain text as textSearch', () => {
      const result = parseQuery('hello world')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('hello world')
    })

    it.concurrent('should preserve text case', () => {
      const result = parseQuery('Hello World')

      expect(result.textSearch).toBe('Hello World')
    })
  })

  describe('level filter', () => {
    it.concurrent('should parse level:error filter', () => {
      const result = parseQuery('level:error')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[0].value).toBe('error')
      expect(result.filters[0].operator).toBe('=')
    })

    it.concurrent('should parse level:info filter', () => {
      const result = parseQuery('level:info')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[0].value).toBe('info')
    })
  })

  describe('status filter (alias for level)', () => {
    it.concurrent('should parse status:error filter', () => {
      const result = parseQuery('status:error')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('status')
      expect(result.filters[0].value).toBe('error')
    })
  })

  describe('workflow filter', () => {
    it.concurrent('should parse workflow filter with quoted value', () => {
      const result = parseQuery('workflow:"my-workflow"')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflow')
      expect(result.filters[0].value).toBe('my-workflow')
    })

    it.concurrent('should parse workflow filter with unquoted value', () => {
      const result = parseQuery('workflow:test-workflow')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflow')
      expect(result.filters[0].value).toBe('test-workflow')
    })
  })

  describe('trigger filter', () => {
    it.concurrent('should parse trigger:api filter', () => {
      const result = parseQuery('trigger:api')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('trigger')
      expect(result.filters[0].value).toBe('api')
    })

    it.concurrent('should parse trigger:webhook filter', () => {
      const result = parseQuery('trigger:webhook')

      expect(result.filters[0].value).toBe('webhook')
    })

    it.concurrent('should parse trigger:schedule filter', () => {
      const result = parseQuery('trigger:schedule')

      expect(result.filters[0].value).toBe('schedule')
    })

    it.concurrent('should parse trigger:manual filter', () => {
      const result = parseQuery('trigger:manual')

      expect(result.filters[0].value).toBe('manual')
    })

    it.concurrent('should parse trigger:chat filter', () => {
      const result = parseQuery('trigger:chat')

      expect(result.filters[0].value).toBe('chat')
    })
  })

  describe('cost filter with operators', () => {
    it.concurrent('should parse cost:>0.01 filter', () => {
      const result = parseQuery('cost:>0.01')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('cost')
      expect(result.filters[0].operator).toBe('>')
      expect(result.filters[0].value).toBe(0.01)
    })

    it.concurrent('should parse cost:<0.005 filter', () => {
      const result = parseQuery('cost:<0.005')

      expect(result.filters[0].operator).toBe('<')
      expect(result.filters[0].value).toBe(0.005)
    })

    it.concurrent('should parse cost:>=0.05 filter', () => {
      const result = parseQuery('cost:>=0.05')

      expect(result.filters[0].operator).toBe('>=')
      expect(result.filters[0].value).toBe(0.05)
    })

    it.concurrent('should parse cost:<=0.1 filter', () => {
      const result = parseQuery('cost:<=0.1')

      expect(result.filters[0].operator).toBe('<=')
      expect(result.filters[0].value).toBe(0.1)
    })

    it.concurrent('should parse cost:!=0 filter', () => {
      const result = parseQuery('cost:!=0')

      expect(result.filters[0].operator).toBe('!=')
      expect(result.filters[0].value).toBe(0)
    })

    it.concurrent('should parse cost:=0 filter', () => {
      const result = parseQuery('cost:=0')

      expect(result.filters[0].operator).toBe('=')
      expect(result.filters[0].value).toBe(0)
    })
  })

  describe('duration filter', () => {
    it.concurrent('should parse duration:>5000 (ms) filter', () => {
      const result = parseQuery('duration:>5000')

      expect(result.filters[0].field).toBe('duration')
      expect(result.filters[0].operator).toBe('>')
      expect(result.filters[0].value).toBe(5000)
    })

    it.concurrent('should parse duration with ms suffix', () => {
      const result = parseQuery('duration:>500ms')

      expect(result.filters[0].value).toBe(500)
    })

    it.concurrent('should parse duration with s suffix (converts to ms)', () => {
      const result = parseQuery('duration:>5s')

      expect(result.filters[0].value).toBe(5000)
    })

    it.concurrent('should parse duration:<1s filter', () => {
      const result = parseQuery('duration:<1s')

      expect(result.filters[0].operator).toBe('<')
      expect(result.filters[0].value).toBe(1000)
    })
  })

  describe('date filter', () => {
    it.concurrent('should parse date:today filter', () => {
      const result = parseQuery('date:today')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('today')
    })

    it.concurrent('should parse date:yesterday filter', () => {
      const result = parseQuery('date:yesterday')

      expect(result.filters[0].value).toBe('yesterday')
    })

    it.concurrent('should parse date:this-week filter', () => {
      const result = parseQuery('date:this-week')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('this-week')
    })

    it.concurrent('should parse date:last-week filter', () => {
      const result = parseQuery('date:last-week')

      expect(result.filters[0].value).toBe('last-week')
    })

    it.concurrent('should parse date:this-month filter', () => {
      const result = parseQuery('date:this-month')

      expect(result.filters[0].value).toBe('this-month')
    })

    it.concurrent('should parse year-only format (YYYY)', () => {
      const result = parseQuery('date:2024')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('2024')
    })

    it.concurrent('should parse month-only format (YYYY-MM)', () => {
      const result = parseQuery('date:2024-12')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('2024-12')
    })

    it.concurrent('should parse full date format (YYYY-MM-DD)', () => {
      const result = parseQuery('date:2024-12-25')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('2024-12-25')
    })

    it.concurrent('should parse date range format (YYYY-MM-DD..YYYY-MM-DD)', () => {
      const result = parseQuery('date:2024-01-01..2024-01-15')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('2024-01-01..2024-01-15')
    })
  })

  describe('folder filter', () => {
    it.concurrent('should parse folder filter with quoted value', () => {
      const result = parseQuery('folder:"My Folder"')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('folder')
      expect(result.filters[0].value).toBe('My Folder')
    })
  })

  describe('ID filters', () => {
    it.concurrent('should parse executionId filter', () => {
      const result = parseQuery('executionId:exec-123-abc')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('executionId')
      expect(result.filters[0].value).toBe('exec-123-abc')
    })

    it.concurrent('should parse workflowId filter', () => {
      const result = parseQuery('workflowId:wf-456-def')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflowId')
      expect(result.filters[0].value).toBe('wf-456-def')
    })

    it.concurrent('should parse execution filter (alias)', () => {
      const result = parseQuery('execution:exec-789')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('execution')
      expect(result.filters[0].value).toBe('exec-789')
    })

    it.concurrent('should parse id filter', () => {
      const result = parseQuery('id:some-id-123')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('id')
    })
  })

  describe('combined filters and text', () => {
    it.concurrent('should parse multiple filters', () => {
      const result = parseQuery('level:error trigger:api')

      expect(result.filters).toHaveLength(2)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[1].field).toBe('trigger')
      expect(result.textSearch).toBe('')
    })

    it.concurrent('should parse filters with text search', () => {
      const result = parseQuery('level:error some search text')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.textSearch).toBe('some search text')
    })

    it.concurrent('should parse text before and after filters', () => {
      const result = parseQuery('before level:error after')

      expect(result.filters).toHaveLength(1)
      expect(result.textSearch).toBe('before after')
    })

    it.concurrent('should parse complex query with multiple filters and text', () => {
      const result = parseQuery(
        'level:error trigger:api cost:>0.01 workflow:"my-workflow" search text'
      )

      expect(result.filters).toHaveLength(4)
      expect(result.textSearch).toBe('search text')
    })
  })

  describe('invalid filters', () => {
    it.concurrent('should treat unknown field as text', () => {
      const result = parseQuery('unknownfield:value')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('unknownfield:value')
    })

    it.concurrent('should handle invalid number for cost', () => {
      const result = parseQuery('cost:>abc')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('cost:>abc')
    })

    it.concurrent('should handle invalid number for duration', () => {
      const result = parseQuery('duration:>notanumber')

      expect(result.filters).toHaveLength(0)
    })
  })
})

describe('queryToApiParams', () => {
  it.concurrent('should return empty object for empty query', () => {
    const parsed = parseQuery('')
    const params = queryToApiParams(parsed)

    expect(Object.keys(params)).toHaveLength(0)
  })

  it.concurrent('should set search param for text search', () => {
    const parsed = parseQuery('hello world')
    const params = queryToApiParams(parsed)

    expect(params.search).toBe('hello world')
  })

  it.concurrent('should set level param for level filter', () => {
    const parsed = parseQuery('level:error')
    const params = queryToApiParams(parsed)

    expect(params.level).toBe('error')
  })

  it.concurrent('should combine multiple level filters with comma', () => {
    const parsed = parseQuery('level:error level:info')
    const params = queryToApiParams(parsed)

    expect(params.level).toBe('error,info')
  })

  it.concurrent('should set triggers param for trigger filter', () => {
    const parsed = parseQuery('trigger:api')
    const params = queryToApiParams(parsed)

    expect(params.triggers).toBe('api')
  })

  it.concurrent('should combine multiple trigger filters', () => {
    const parsed = parseQuery('trigger:api trigger:webhook')
    const params = queryToApiParams(parsed)

    expect(params.triggers).toBe('api,webhook')
  })

  it.concurrent('should set workflowName param for workflow filter', () => {
    const parsed = parseQuery('workflow:"my-workflow"')
    const params = queryToApiParams(parsed)

    expect(params.workflowName).toBe('my-workflow')
  })

  it.concurrent('should set folderName param for folder filter', () => {
    const parsed = parseQuery('folder:"My Folder"')
    const params = queryToApiParams(parsed)

    expect(params.folderName).toBe('My Folder')
  })

  it.concurrent('should set workflowIds param for workflowId filter', () => {
    const parsed = parseQuery('workflowId:wf-123')
    const params = queryToApiParams(parsed)

    expect(params.workflowIds).toBe('wf-123')
  })

  it.concurrent('should set executionId param for executionId filter', () => {
    const parsed = parseQuery('executionId:exec-456')
    const params = queryToApiParams(parsed)

    expect(params.executionId).toBe('exec-456')
  })

  it.concurrent('should set cost params with operator', () => {
    const parsed = parseQuery('cost:>0.01')
    const params = queryToApiParams(parsed)

    expect(params.costOperator).toBe('>')
    expect(params.costValue).toBe('0.01')
  })

  it.concurrent('should set duration params with operator', () => {
    const parsed = parseQuery('duration:>5s')
    const params = queryToApiParams(parsed)

    expect(params.durationOperator).toBe('>')
    expect(params.durationValue).toBe('5000')
  })

  it('should set startDate for date:today', () => {
    const parsed = parseQuery('date:today')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    const startDate = new Date(params.startDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(startDate.getTime()).toBe(today.getTime())
  })

  it('should set startDate and endDate for date:yesterday', () => {
    const parsed = parseQuery('date:yesterday')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()
  })

  it('should set startDate for date:this-week', () => {
    const parsed = parseQuery('date:this-week')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    const startDate = new Date(params.startDate)
    expect(startDate.getDay()).toBe(0)
  })

  it('should set startDate and endDate for date:last-week', () => {
    const parsed = parseQuery('date:last-week')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()
  })

  it('should set startDate for date:this-month', () => {
    const parsed = parseQuery('date:this-month')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    const startDate = new Date(params.startDate)
    expect(startDate.getDate()).toBe(1)
  })

  it.concurrent('should set startDate and endDate for year-only (date:2024)', () => {
    const parsed = parseQuery('date:2024')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()

    const startDate = new Date(params.startDate)
    const endDate = new Date(params.endDate)

    expect(startDate.getFullYear()).toBe(2024)
    expect(startDate.getMonth()).toBe(0)
    expect(startDate.getDate()).toBe(1)

    expect(endDate.getFullYear()).toBe(2024)
    expect(endDate.getMonth()).toBe(11)
    expect(endDate.getDate()).toBe(31)
  })

  it.concurrent('should set startDate and endDate for month-only (date:2024-12)', () => {
    const parsed = parseQuery('date:2024-12')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()

    const startDate = new Date(params.startDate)
    const endDate = new Date(params.endDate)

    expect(startDate.getFullYear()).toBe(2024)
    expect(startDate.getMonth()).toBe(11)
    expect(startDate.getDate()).toBe(1)

    expect(endDate.getFullYear()).toBe(2024)
    expect(endDate.getMonth()).toBe(11)
    expect(endDate.getDate()).toBe(31)
  })

  it.concurrent('should set startDate and endDate for full date (date:2024-12-25)', () => {
    const parsed = parseQuery('date:2024-12-25')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()

    const startDate = new Date(params.startDate)
    const endDate = new Date(params.endDate)

    expect(startDate.getFullYear()).toBe(2024)
    expect(startDate.getMonth()).toBe(11)
    expect(startDate.getDate()).toBe(25)

    expect(endDate.getFullYear()).toBe(2024)
    expect(endDate.getMonth()).toBe(11)
    expect(endDate.getDate()).toBe(25)
  })

  it.concurrent(
    'should set startDate and endDate for date range (date:2024-01-01..2024-01-15)',
    () => {
      const parsed = parseQuery('date:2024-01-01..2024-01-15')
      const params = queryToApiParams(parsed)

      expect(params.startDate).toBeDefined()
      expect(params.endDate).toBeDefined()

      const startDate = new Date(params.startDate)
      const endDate = new Date(params.endDate)

      expect(startDate.getFullYear()).toBe(2024)
      expect(startDate.getMonth()).toBe(0)
      expect(startDate.getDate()).toBe(1)

      expect(endDate.getFullYear()).toBe(2024)
      expect(endDate.getMonth()).toBe(0)
      expect(endDate.getDate()).toBe(15)
    }
  )

  it.concurrent('should combine execution filter with text search', () => {
    const parsed = {
      filters: [
        {
          field: 'execution',
          operator: '=' as const,
          value: 'exec-123',
          originalValue: 'exec-123',
        },
      ],
      textSearch: 'some text',
    }
    const params = queryToApiParams(parsed)

    expect(params.search).toBe('some text exec-123')
  })

  it.concurrent('should handle complex query with all params', () => {
    const parsed = parseQuery('level:error trigger:api cost:>0.01 workflow:"test"')
    const params = queryToApiParams(parsed)

    expect(params.level).toBe('error')
    expect(params.triggers).toBe('api')
    expect(params.costOperator).toBe('>')
    expect(params.costValue).toBe('0.01')
    expect(params.workflowName).toBe('test')
  })
})
