import { describe, expect, test } from 'vitest'
import {
  FILTER_DEFINITIONS,
  type FolderData,
  SearchSuggestions,
  type TriggerData,
  type WorkflowData,
} from '@/lib/logs/search-suggestions'

describe('FILTER_DEFINITIONS', () => {
  test('should have level filter definition', () => {
    const levelFilter = FILTER_DEFINITIONS.find((f) => f.key === 'level')

    expect(levelFilter).toBeDefined()
    expect(levelFilter?.label).toBe('Status')
    expect(levelFilter?.options).toHaveLength(2)
    expect(levelFilter?.options.map((o) => o.value)).toContain('error')
    expect(levelFilter?.options.map((o) => o.value)).toContain('info')
  })

  test('should have cost filter definition with multiple options', () => {
    const costFilter = FILTER_DEFINITIONS.find((f) => f.key === 'cost')

    expect(costFilter).toBeDefined()
    expect(costFilter?.label).toBe('Cost')
    expect(costFilter?.options.length).toBeGreaterThan(0)
    expect(costFilter?.options.map((o) => o.value)).toContain('>0.01')
    expect(costFilter?.options.map((o) => o.value)).toContain('<0.005')
  })

  test('should have date filter definition', () => {
    const dateFilter = FILTER_DEFINITIONS.find((f) => f.key === 'date')

    expect(dateFilter).toBeDefined()
    expect(dateFilter?.label).toBe('Date')
    expect(dateFilter?.options.map((o) => o.value)).toContain('today')
    expect(dateFilter?.options.map((o) => o.value)).toContain('yesterday')
  })

  test('should have duration filter definition', () => {
    const durationFilter = FILTER_DEFINITIONS.find((f) => f.key === 'duration')

    expect(durationFilter).toBeDefined()
    expect(durationFilter?.label).toBe('Duration')
    expect(durationFilter?.options.map((o) => o.value)).toContain('>5s')
    expect(durationFilter?.options.map((o) => o.value)).toContain('<1s')
  })
})

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

  describe('constructor', () => {
    test('should create instance with empty data', () => {
      const suggestions = new SearchSuggestions()
      expect(suggestions).toBeDefined()
    })

    test('should create instance with provided data', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      expect(suggestions).toBeDefined()
    })
  })

  describe('updateData', () => {
    test('should update internal data', () => {
      const suggestions = new SearchSuggestions()
      suggestions.updateData(mockWorkflows, mockFolders, mockTriggers)

      const result = suggestions.getSuggestions('workflow:')
      expect(result).not.toBeNull()
      expect(result?.suggestions.length).toBeGreaterThan(0)
    })
  })

  describe('getSuggestions - empty input', () => {
    test('should return filter keys list for empty input', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('filter-keys')
      expect(result?.suggestions.length).toBeGreaterThan(0)
    })

    test('should include core filter keys', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('')

      const filterValues = result?.suggestions.map((s) => s.value)
      expect(filterValues).toContain('level:')
      expect(filterValues).toContain('cost:')
      expect(filterValues).toContain('date:')
      expect(filterValues).toContain('duration:')
      expect(filterValues).toContain('trigger:')
    })

    test('should include workflow filter when workflows exist', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('')

      const filterValues = result?.suggestions.map((s) => s.value)
      expect(filterValues).toContain('workflow:')
    })

    test('should include folder filter when folders exist', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('')

      const filterValues = result?.suggestions.map((s) => s.value)
      expect(filterValues).toContain('folder:')
    })

    test('should not include workflow filter when no workflows', () => {
      const suggestions = new SearchSuggestions([], mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('')

      const filterValues = result?.suggestions.map((s) => s.value)
      expect(filterValues).not.toContain('workflow:')
    })
  })

  describe('getSuggestions - filter values (ending with colon)', () => {
    test('should return level filter values', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('level:')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.value === 'level:error')).toBe(true)
      expect(result?.suggestions.some((s) => s.value === 'level:info')).toBe(true)
    })

    test('should return cost filter values', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('cost:')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.value === 'cost:>0.01')).toBe(true)
    })

    test('should return trigger filter values', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('trigger:')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.value === 'trigger:api')).toBe(true)
      expect(result?.suggestions.some((s) => s.value === 'trigger:manual')).toBe(true)
    })

    test('should return workflow filter values', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('workflow:')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.label === 'Test Workflow')).toBe(true)
    })

    test('should return folder filter values', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('folder:')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('filter-values')
      expect(result?.suggestions.some((s) => s.label === 'Development')).toBe(true)
    })

    test('should return null for unknown filter key', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('unknown:')

      expect(result).toBeNull()
    })
  })

  describe('getSuggestions - partial filter values', () => {
    test('should filter level values by partial input', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('level:err')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.value === 'level:error')).toBe(true)
      expect(result?.suggestions.some((s) => s.value === 'level:info')).toBe(false)
    })

    test('should filter workflow values by partial input', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('workflow:test')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.label === 'Test Workflow')).toBe(true)
      expect(result?.suggestions.some((s) => s.label === 'Production Pipeline')).toBe(false)
    })

    test('should filter trigger values by partial input', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('trigger:sch')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.value === 'trigger:schedule')).toBe(true)
    })

    test('should return null when no matches found', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('level:xyz')

      expect(result).toBeNull()
    })
  })

  describe('getSuggestions - plain text search (multi-section)', () => {
    test('should return multi-section results for plain text', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('test')

      expect(result).not.toBeNull()
      expect(result?.type).toBe('multi-section')
    })

    test('should include show-all suggestion', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('test')

      expect(result?.suggestions.some((s) => s.category === 'show-all')).toBe(true)
    })

    test('should match workflows by name', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('production')

      expect(result?.suggestions.some((s) => s.label === 'Production Pipeline')).toBe(true)
    })

    test('should match workflows by description', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('API requests')

      expect(result?.suggestions.some((s) => s.label === 'API Handler')).toBe(true)
    })

    test('should match folders by name', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('development')

      expect(result?.suggestions.some((s) => s.label === 'Development')).toBe(true)
    })

    test('should match triggers by label', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('slack')

      expect(result?.suggestions.some((s) => s.value === 'trigger:slack')).toBe(true)
    })

    test('should match filter values', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('error')

      expect(result?.suggestions.some((s) => s.value === 'level:error')).toBe(true)
    })

    test('should show suggested filters when no matches found', () => {
      const suggestions = new SearchSuggestions([], [], [])
      const result = suggestions.getSuggestions('xyz123')

      expect(result).not.toBeNull()
      expect(result?.suggestions.some((s) => s.category === 'show-all')).toBe(true)
    })
  })

  describe('getSuggestions - case insensitivity', () => {
    test('should match regardless of case', () => {
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
    test('should sort exact matches first', () => {
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

    test('should sort prefix matches before substring matches', () => {
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
    test('should limit workflow results to 8', () => {
      const manyWorkflows = Array.from({ length: 20 }, (_, i) => ({
        id: `wf-${i}`,
        name: `Test Workflow ${i}`,
      }))
      const suggestions = new SearchSuggestions(manyWorkflows, [], [])
      const result = suggestions.getSuggestions('test')

      const workflowSuggestions = result?.suggestions.filter((s) => s.category === 'workflow')
      expect(workflowSuggestions?.length).toBeLessThanOrEqual(8)
    })

    test('should limit filter value results to 5', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('o') // Matches multiple filter values

      const filterSuggestions = result?.suggestions.filter(
        (s) =>
          s.category !== 'show-all' &&
          s.category !== 'workflow' &&
          s.category !== 'folder' &&
          s.category !== 'trigger'
      )
      expect(filterSuggestions?.length).toBeLessThanOrEqual(5)
    })
  })

  describe('getSuggestions - suggestion structure', () => {
    test('should include correct properties for filter key suggestions', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('')

      const suggestion = result?.suggestions[0]
      expect(suggestion).toHaveProperty('id')
      expect(suggestion).toHaveProperty('value')
      expect(suggestion).toHaveProperty('label')
      expect(suggestion).toHaveProperty('category')
    })

    test('should include color for trigger suggestions', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('trigger:')

      const triggerSuggestion = result?.suggestions.find((s) => s.value === 'trigger:api')
      expect(triggerSuggestion?.color).toBeDefined()
    })

    test('should quote workflow names in value', () => {
      const suggestions = new SearchSuggestions(mockWorkflows, mockFolders, mockTriggers)
      const result = suggestions.getSuggestions('workflow:')

      const workflowSuggestion = result?.suggestions.find((s) => s.label === 'Test Workflow')
      expect(workflowSuggestion?.value).toBe('workflow:"Test Workflow"')
    })
  })
})
