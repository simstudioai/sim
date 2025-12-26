import { describe, expect, test } from 'vitest'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'

describe('parseQuery', () => {
  describe('empty and whitespace input', () => {
    test('should handle empty string', () => {
      const result = parseQuery('')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('')
    })

    test('should handle whitespace only', () => {
      const result = parseQuery('   ')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('')
    })
  })

  describe('simple text search', () => {
    test('should parse plain text as textSearch', () => {
      const result = parseQuery('hello world')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('hello world')
    })

    test('should preserve text case', () => {
      const result = parseQuery('Hello World')

      expect(result.textSearch).toBe('Hello World')
    })
  })

  describe('level filter', () => {
    test('should parse level:error filter', () => {
      const result = parseQuery('level:error')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[0].value).toBe('error')
      expect(result.filters[0].operator).toBe('=')
    })

    test('should parse level:info filter', () => {
      const result = parseQuery('level:info')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[0].value).toBe('info')
    })
  })

  describe('status filter (alias for level)', () => {
    test('should parse status:error filter', () => {
      const result = parseQuery('status:error')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('status')
      expect(result.filters[0].value).toBe('error')
    })
  })

  describe('workflow filter', () => {
    test('should parse workflow filter with quoted value', () => {
      const result = parseQuery('workflow:"my-workflow"')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflow')
      expect(result.filters[0].value).toBe('my-workflow')
    })

    test('should parse workflow filter with unquoted value', () => {
      const result = parseQuery('workflow:test-workflow')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflow')
      expect(result.filters[0].value).toBe('test-workflow')
    })
  })

  describe('trigger filter', () => {
    test('should parse trigger:api filter', () => {
      const result = parseQuery('trigger:api')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('trigger')
      expect(result.filters[0].value).toBe('api')
    })

    test('should parse trigger:webhook filter', () => {
      const result = parseQuery('trigger:webhook')

      expect(result.filters[0].value).toBe('webhook')
    })

    test('should parse trigger:schedule filter', () => {
      const result = parseQuery('trigger:schedule')

      expect(result.filters[0].value).toBe('schedule')
    })

    test('should parse trigger:manual filter', () => {
      const result = parseQuery('trigger:manual')

      expect(result.filters[0].value).toBe('manual')
    })

    test('should parse trigger:chat filter', () => {
      const result = parseQuery('trigger:chat')

      expect(result.filters[0].value).toBe('chat')
    })
  })

  describe('cost filter with operators', () => {
    test('should parse cost:>0.01 filter', () => {
      const result = parseQuery('cost:>0.01')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('cost')
      expect(result.filters[0].operator).toBe('>')
      expect(result.filters[0].value).toBe(0.01)
    })

    test('should parse cost:<0.005 filter', () => {
      const result = parseQuery('cost:<0.005')

      expect(result.filters[0].operator).toBe('<')
      expect(result.filters[0].value).toBe(0.005)
    })

    test('should parse cost:>=0.05 filter', () => {
      const result = parseQuery('cost:>=0.05')

      expect(result.filters[0].operator).toBe('>=')
      expect(result.filters[0].value).toBe(0.05)
    })

    test('should parse cost:<=0.1 filter', () => {
      const result = parseQuery('cost:<=0.1')

      expect(result.filters[0].operator).toBe('<=')
      expect(result.filters[0].value).toBe(0.1)
    })

    test('should parse cost:!=0 filter', () => {
      const result = parseQuery('cost:!=0')

      expect(result.filters[0].operator).toBe('!=')
      expect(result.filters[0].value).toBe(0)
    })

    test('should parse cost:=0 filter', () => {
      const result = parseQuery('cost:=0')

      expect(result.filters[0].operator).toBe('=')
      expect(result.filters[0].value).toBe(0)
    })
  })

  describe('duration filter', () => {
    test('should parse duration:>5000 (ms) filter', () => {
      const result = parseQuery('duration:>5000')

      expect(result.filters[0].field).toBe('duration')
      expect(result.filters[0].operator).toBe('>')
      expect(result.filters[0].value).toBe(5000)
    })

    test('should parse duration with ms suffix', () => {
      const result = parseQuery('duration:>500ms')

      expect(result.filters[0].value).toBe(500)
    })

    test('should parse duration with s suffix (converts to ms)', () => {
      const result = parseQuery('duration:>5s')

      expect(result.filters[0].value).toBe(5000)
    })

    test('should parse duration:<1s filter', () => {
      const result = parseQuery('duration:<1s')

      expect(result.filters[0].operator).toBe('<')
      expect(result.filters[0].value).toBe(1000)
    })
  })

  describe('date filter', () => {
    test('should parse date:today filter', () => {
      const result = parseQuery('date:today')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('date')
      expect(result.filters[0].value).toBe('today')
    })

    test('should parse date:yesterday filter', () => {
      const result = parseQuery('date:yesterday')

      expect(result.filters[0].value).toBe('yesterday')
    })
  })

  describe('folder filter', () => {
    test('should parse folder filter with quoted value', () => {
      const result = parseQuery('folder:"My Folder"')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('folder')
      expect(result.filters[0].value).toBe('My Folder')
    })
  })

  describe('ID filters', () => {
    test('should parse executionId filter', () => {
      const result = parseQuery('executionId:exec-123-abc')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('executionId')
      expect(result.filters[0].value).toBe('exec-123-abc')
    })

    test('should parse workflowId filter', () => {
      const result = parseQuery('workflowId:wf-456-def')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflowId')
      expect(result.filters[0].value).toBe('wf-456-def')
    })

    test('should parse execution filter (alias)', () => {
      const result = parseQuery('execution:exec-789')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('execution')
      expect(result.filters[0].value).toBe('exec-789')
    })

    test('should parse id filter', () => {
      const result = parseQuery('id:some-id-123')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('id')
    })
  })

  describe('combined filters and text', () => {
    test('should parse multiple filters', () => {
      const result = parseQuery('level:error trigger:api')

      expect(result.filters).toHaveLength(2)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[1].field).toBe('trigger')
      expect(result.textSearch).toBe('')
    })

    test('should parse filters with text search', () => {
      const result = parseQuery('level:error some search text')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.textSearch).toBe('some search text')
    })

    test('should parse text before and after filters', () => {
      const result = parseQuery('before level:error after')

      expect(result.filters).toHaveLength(1)
      expect(result.textSearch).toBe('before after')
    })

    test('should parse complex query with multiple filters and text', () => {
      const result = parseQuery(
        'level:error trigger:api cost:>0.01 workflow:"my-workflow" search text'
      )

      expect(result.filters).toHaveLength(4)
      expect(result.textSearch).toBe('search text')
    })
  })

  describe('invalid filters', () => {
    test('should treat unknown field as text', () => {
      const result = parseQuery('unknownfield:value')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('unknownfield:value')
    })

    test('should handle invalid number for cost', () => {
      const result = parseQuery('cost:>abc')

      expect(result.filters).toHaveLength(0)
      expect(result.textSearch).toBe('cost:>abc')
    })

    test('should handle invalid number for duration', () => {
      const result = parseQuery('duration:>notanumber')

      expect(result.filters).toHaveLength(0)
    })
  })
})

describe('queryToApiParams', () => {
  test('should return empty object for empty query', () => {
    const parsed = parseQuery('')
    const params = queryToApiParams(parsed)

    expect(Object.keys(params)).toHaveLength(0)
  })

  test('should set search param for text search', () => {
    const parsed = parseQuery('hello world')
    const params = queryToApiParams(parsed)

    expect(params.search).toBe('hello world')
  })

  test('should set level param for level filter', () => {
    const parsed = parseQuery('level:error')
    const params = queryToApiParams(parsed)

    expect(params.level).toBe('error')
  })

  test('should combine multiple level filters with comma', () => {
    const parsed = parseQuery('level:error level:info')
    const params = queryToApiParams(parsed)

    expect(params.level).toBe('error,info')
  })

  test('should set triggers param for trigger filter', () => {
    const parsed = parseQuery('trigger:api')
    const params = queryToApiParams(parsed)

    expect(params.triggers).toBe('api')
  })

  test('should combine multiple trigger filters', () => {
    const parsed = parseQuery('trigger:api trigger:webhook')
    const params = queryToApiParams(parsed)

    expect(params.triggers).toBe('api,webhook')
  })

  test('should set workflowName param for workflow filter', () => {
    const parsed = parseQuery('workflow:"my-workflow"')
    const params = queryToApiParams(parsed)

    expect(params.workflowName).toBe('my-workflow')
  })

  test('should set folderName param for folder filter', () => {
    const parsed = parseQuery('folder:"My Folder"')
    const params = queryToApiParams(parsed)

    expect(params.folderName).toBe('My Folder')
  })

  test('should set workflowIds param for workflowId filter', () => {
    const parsed = parseQuery('workflowId:wf-123')
    const params = queryToApiParams(parsed)

    expect(params.workflowIds).toBe('wf-123')
  })

  test('should set executionId param for executionId filter', () => {
    const parsed = parseQuery('executionId:exec-456')
    const params = queryToApiParams(parsed)

    expect(params.executionId).toBe('exec-456')
  })

  test('should set cost params with operator', () => {
    const parsed = parseQuery('cost:>0.01')
    const params = queryToApiParams(parsed)

    expect(params.costOperator).toBe('>')
    expect(params.costValue).toBe('0.01')
  })

  test('should set duration params with operator', () => {
    const parsed = parseQuery('duration:>5s')
    const params = queryToApiParams(parsed)

    expect(params.durationOperator).toBe('>')
    expect(params.durationValue).toBe('5000')
  })

  test('should set startDate for date:today', () => {
    const parsed = parseQuery('date:today')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    const startDate = new Date(params.startDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(startDate.getTime()).toBe(today.getTime())
  })

  test('should set startDate and endDate for date:yesterday', () => {
    const parsed = parseQuery('date:yesterday')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()
  })

  test('should combine execution filter with text search', () => {
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

  test('should handle complex query with all params', () => {
    const parsed = parseQuery('level:error trigger:api cost:>0.01 workflow:"test"')
    const params = queryToApiParams(parsed)

    expect(params.level).toBe('error')
    expect(params.triggers).toBe('api')
    expect(params.costOperator).toBe('>')
    expect(params.costValue).toBe('0.01')
    expect(params.workflowName).toBe('test')
  })
})
