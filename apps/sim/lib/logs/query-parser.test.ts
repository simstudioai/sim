/**
 * Tests for query language parser for logs search
 */

import { describe, expect, it } from 'vitest'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'

describe('parseQuery', () => {
  describe('level filter', () => {
    it.concurrent('should parse level:error filter', () => {
      const result = parseQuery('level:error')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[0].value).toBe('error')
      expect(result.filters[0].operator).toBe('=')
    })
  })

  describe('workflow filter', () => {
    it.concurrent('should parse workflow filter with quoted value', () => {
      const result = parseQuery('workflow:"my-workflow"')

      expect(result.filters).toHaveLength(1)
      expect(result.filters[0].field).toBe('workflow')
      expect(result.filters[0].value).toBe('my-workflow')
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
  })

  describe('duration filter', () => {
    it.concurrent('should parse duration:>5000 (ms) filter', () => {
      const result = parseQuery('duration:>5000')

      expect(result.filters[0].field).toBe('duration')
      expect(result.filters[0].operator).toBe('>')
      expect(result.filters[0].value).toBe(5000)
    })

    it.concurrent('should parse duration with s suffix (converts to ms)', () => {
      const result = parseQuery('duration:>5s')

      expect(result.filters[0].value).toBe(5000)
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

  describe('combined filters and text', () => {
    it.concurrent('should parse multiple filters', () => {
      const result = parseQuery('level:error trigger:api')

      expect(result.filters).toHaveLength(2)
      expect(result.filters[0].field).toBe('level')
      expect(result.filters[1].field).toBe('trigger')
      expect(result.textSearch).toBe('')
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
  })
})

describe('queryToApiParams', () => {
  it('should set startDate and endDate for date:last-week', () => {
    const parsed = parseQuery('date:last-week')
    const params = queryToApiParams(parsed)

    expect(params.startDate).toBeDefined()
    expect(params.endDate).toBeDefined()
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
})
