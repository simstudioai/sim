import { describe, expect, it } from 'vitest'
import { SearchSuggestions } from './search-suggestions'

describe('SearchSuggestions', () => {
  const engine = new SearchSuggestions(['workflow1', 'workflow2'], ['folder1', 'folder2'])

  describe('validateQuery', () => {
    it.concurrent('should return false for incomplete filter expressions', () => {
      expect(engine.validateQuery('level:')).toBe(false)
      expect(engine.validateQuery('trigger:')).toBe(false)
      expect(engine.validateQuery('cost:')).toBe(false)
      expect(engine.validateQuery('some text level:')).toBe(false)
    })

    it.concurrent('should return false for incomplete quoted strings', () => {
      expect(engine.validateQuery('workflow:"incomplete')).toBe(false)
      expect(engine.validateQuery('level:error workflow:"incomplete')).toBe(false)
      expect(engine.validateQuery('"incomplete string')).toBe(false)
    })

    it.concurrent('should return true for complete queries', () => {
      expect(engine.validateQuery('level:error')).toBe(true)
      expect(engine.validateQuery('trigger:api')).toBe(true)
      expect(engine.validateQuery('cost:>0.01')).toBe(true)
      expect(engine.validateQuery('workflow:"test workflow"')).toBe(true)
      expect(engine.validateQuery('level:error trigger:api')).toBe(true)
      expect(engine.validateQuery('some search text')).toBe(true)
      expect(engine.validateQuery('')).toBe(true)
    })

    it.concurrent('should return true for mixed complete queries', () => {
      expect(engine.validateQuery('search text level:error')).toBe(true)
      expect(engine.validateQuery('level:error some search')).toBe(true)
      expect(engine.validateQuery('workflow:"test" level:error search')).toBe(true)
    })
  })

  describe('getSuggestions', () => {
    it.concurrent('should return filter key suggestions at the beginning', () => {
      const result = engine.getSuggestions('', 0)
      expect(result?.type).toBe('filter-keys')
      expect(result?.suggestions.length).toBeGreaterThan(0)
      expect(result?.suggestions.some((s) => s.value === 'level:')).toBe(true)
    })

    it.concurrent('should return value suggestions for uniquely identified partial keys', () => {
      const result = engine.getSuggestions('lev', 3)
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.value === 'error' || s.value === 'info')).toBe(true)
    })

    it.concurrent('should return filter value suggestions after colon', () => {
      const result = engine.getSuggestions('level:', 6)
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.length).toBeGreaterThan(0)
      expect(result?.suggestions.some((s) => s.value === 'error')).toBe(true)
    })

    it.concurrent('should return filtered value suggestions for partial values', () => {
      const result = engine.getSuggestions('level:err', 9)
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.value === 'error')).toBe(true)
    })

    it.concurrent('should handle workflow suggestions', () => {
      const result = engine.getSuggestions('workflow:', 9)
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.label === 'workflow1')).toBe(true)
    })

    it.concurrent('should return null for text search context', () => {
      const result = engine.getSuggestions('some random text', 10)
      expect(result).toBe(null)
    })

    it.concurrent('should show filter key suggestions after completing a filter', () => {
      const result = engine.getSuggestions('level:error ', 12)
      expect(result?.type).toBe('filter-keys')
      expect(result?.suggestions.length).toBeGreaterThan(0)
      expect(result?.suggestions.some((s) => s.value === 'level:')).toBe(true)
      expect(result?.suggestions.some((s) => s.value === 'trigger:')).toBe(true)
    })

    it.concurrent('should show filter key suggestions after multiple completed filters', () => {
      const result = engine.getSuggestions('level:error trigger:api ', 24)
      expect(result?.type).toBe('filter-keys')
      expect(result?.suggestions.length).toBeGreaterThan(0)
    })

    it.concurrent(
      'should surface value suggestions for uniquely matched partial keys after existing filters',
      () => {
        const result = engine.getSuggestions('level:error lev', 15)
        expect(result?.type).toBe('filter-values')
        expect(result?.suggestions.some((s) => s.value === 'error' || s.value === 'info')).toBe(
          true
        )
      }
    )

    it.concurrent('should handle filter values after existing filters', () => {
      const result = engine.getSuggestions('level:error level:', 18)
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.value === 'info')).toBe(true)
    })
  })

  describe('generatePreview', () => {
    it.concurrent('should generate correct preview for filter keys', () => {
      const suggestion = {
        id: 'test',
        value: 'level:',
        label: 'Status',
        category: 'filters' as const,
      }
      const preview = engine.generatePreview(suggestion, '', 0)
      expect(preview).toBe('level:')
    })

    it.concurrent('should generate correct preview for filter values', () => {
      const suggestion = { id: 'test', value: 'error', label: 'Error', category: 'level' as const }
      const preview = engine.generatePreview(suggestion, 'level:', 6)
      expect(preview).toBe('level:error')
    })

    it.concurrent('should handle partial replacements correctly', () => {
      const suggestion = {
        id: 'test',
        value: 'level:',
        label: 'Status',
        category: 'filters' as const,
      }
      const preview = engine.generatePreview(suggestion, 'lev', 3)
      expect(preview).toBe('level:')
    })

    it.concurrent('should handle quoted workflow values', () => {
      const suggestion = {
        id: 'test',
        value: '"workflow1"',
        label: 'workflow1',
        category: 'workflow' as const,
      }
      const preview = engine.generatePreview(suggestion, 'workflow:', 9)
      expect(preview).toBe('workflow:"workflow1"')
    })

    it.concurrent('should add space when adding filter after completed filter', () => {
      const suggestion = {
        id: 'test',
        value: 'trigger:',
        label: 'Trigger',
        category: 'filters' as const,
      }
      const preview = engine.generatePreview(suggestion, 'level:error ', 12)
      expect(preview).toBe('level:error trigger:')
    })

    it.concurrent('should handle multiple completed filters', () => {
      const suggestion = { id: 'test', value: 'cost:', label: 'Cost', category: 'filters' as const }
      const preview = engine.generatePreview(suggestion, 'level:error trigger:api ', 24)
      expect(preview).toBe('level:error trigger:api cost:')
    })

    it.concurrent('should handle adding same filter type multiple times', () => {
      const suggestion = {
        id: 'test',
        value: 'level:',
        label: 'Status',
        category: 'filters' as const,
      }
      const preview = engine.generatePreview(suggestion, 'level:error ', 12)
      expect(preview).toBe('level:error level:')
    })

    it.concurrent('should handle filter value after existing filters', () => {
      const suggestion = { id: 'test', value: 'info', label: 'Info', category: 'level' as const }
      const preview = engine.generatePreview(suggestion, 'level:error level:', 19)
      expect(preview).toBe('level:error level:info')
    })
  })
})
