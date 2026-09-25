/**
 * Tests for search suggestions functionality in logs search
 */
import { describe, expect, it } from 'vitest'
import {
  type FolderData,
  SearchSuggestions,
  type TriggerData,
  type WorkflowData,
} from '@/lib/logs/search-suggestions'

describe('SearchSuggestions', () => {
  const mockWorkflows: WorkflowData[] = [
    { id: 'wf-1', name: 'Test Workflow', description: 'A test workflow' },
    { id: 'wf-2', name: 'Production Pipeline', description: 'Main production flow' },
    { id: 'wf-3', name: 'API Handler', description: 'Handles API requests' },
  ]

  const mockFolders: FolderData[] = [
    { id: 'folder-1', name: 'Development' },
    { id: 'folder-2', name: 'Production' },
    { id: 'folder-3', name: 'Testing' },
  ]

  const mockTriggers: TriggerData[] = [
    { value: 'manual', label: 'Manual', color: '#6b7280' },
    { value: 'api', label: 'API', color: '#2563eb' },
    { value: 'schedule', label: 'Schedule', color: '#059669' },
    { value: 'webhook', label: 'Webhook', color: '#ea580c' },
    { value: 'slack', label: 'Slack', color: '#4A154B' },
  ]

  describe('getSuggestions - partial filter values', () => {
    it.concurrent('should filter level values by partial input', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('level:err')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.value === 'level:error')).toBe(true)
      expect(result?.suggestions.some((s) => s.value === 'level:info')).toBe(false)
    })
  })

  describe('getSuggestions - case insensitivity', () => {
    it.concurrent('should match regardless of case', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)

      const lowerResult = suggestions.getSuggestions('test')
      const upperResult = suggestions.getSuggestions('TEST')
      const mixedResult = suggestions.getSuggestions('TeSt')

      expect(lowerResult?.suggestions.some((s) => s.label === 'Test Workflow')).toBe(true)
      expect(upperResult?.suggestions.some((s) => s.label === 'Test Workflow')).toBe(true)
      expect(mixedResult?.suggestions.some((s) => s.label === 'Test Workflow')).toBe(true)
    })
  })

  describe('getSuggestions - sorting', () => {
    it.concurrent('should sort exact matches first', () => {
      const workflows: WorkflowData[] = [
        { id: '1', name: 'API Handler' },
        { id: '2', name: 'API' },
        { id: '3', name: 'Another API Thing' },
      ]
      const suggestions = new SearchSuggestions(workflows, [], [])
      const result = suggestions.getSuggestions('api')

      const workflowSuggestions = result?.suggestions.filter((s) => s.category === 'workflow')
      expect(workflowSuggestions?.[0]?.label).toBe('API')
    })

    it.concurrent('should sort prefix matches before substring matches', () => {
      const workflows: WorkflowData[] = [
        { id: '1', name: 'Contains Test Inside' },
        { id: '2', name: 'Test First' },
      ]
      const suggestions = new SearchSuggestions(workflows, [], [])
      const result = suggestions.getSuggestions('test')

      const workflowSuggestions = result?.suggestions.filter((s) => s.category === 'workflow')
      expect(workflowSuggestions?.[0]?.label).toBe('Test First')
    })
  })

  describe('getSuggestions - result limits', () => {
    it.concurrent('should limit workflow results to 8', () => {
      const manyWorkflows = Array.from({ length: 20 }, (_, i) => ({
        id: `wf-${i}`,
        name: `Test Workflow ${i}`,
      }))
      const suggestions = new SearchSuggestions(manyWorkflows, [], [])
      const result = suggestions.getSuggestions('test')

      const workflowSuggestions = result?.suggestions.filter((s) => s.category === 'workflow')
      expect(workflowSuggestions?.length).toBeLessThanOrEqual(8)
    })
  })

  describe('getSuggestions - date filter values', () => {
    it.concurrent('should suggest year format when typing a year', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('date:2024')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.value === 'date:2024')).toBe(true)
      expect(result?.suggestions.some((s) => s.label === 'Year 2024')).toBe(true)
    })

    it.concurrent('should suggest completing range when typing date..', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('date:2024-01-01..')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.description?.includes('Type end date'))).toBe(true)
    })
  })
})
