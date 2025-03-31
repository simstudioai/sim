/**
 * @vitest-environment jsdom
 *
 * Typeform Responses Tool Unit Tests
 *
 * This file contains unit tests for the Typeform Responses tool,
 * which is used to fetch form responses from the Typeform API.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToolTester } from '../__test-utils__/test-tools'
import { responsesTool } from './responses'

describe('Typeform Responses Tool', () => {
  let tester: ToolTester

  // Mock response data
  const mockResponsesData = {
    total_items: 2,
    page_count: 1,
    items: [
      {
        landing_id: 'landing-id-1',
        token: 'response-id-1',
        landed_at: '2023-01-01T10:00:00Z',
        submitted_at: '2023-01-01T10:05:00Z',
        metadata: {
          user_agent: 'Mozilla/5.0',
          platform: 'web',
          referer: 'https://example.com',
          network_id: 'network-id-1',
          browser: 'chrome',
        },
        answers: [
          {
            field: {
              id: 'field-id-1',
              type: 'short_text',
              ref: 'ref-1',
            },
            type: 'text',
            text: 'Sample answer',
          },
        ],
        hidden: {},
        calculated: {
          score: 0,
        },
        variables: [],
      },
      {
        landing_id: 'landing-id-2',
        token: 'response-id-2',
        landed_at: '2023-01-02T10:00:00Z',
        submitted_at: '2023-01-02T10:05:00Z',
        metadata: {
          user_agent: 'Mozilla/5.0',
          platform: 'web',
          referer: 'https://example.com',
          network_id: 'network-id-2',
          browser: 'chrome',
        },
        answers: [
          {
            field: {
              id: 'field-id-1',
              type: 'short_text',
              ref: 'ref-1',
            },
            type: 'text',
            text: 'Another answer',
          },
        ],
        hidden: {},
        calculated: {
          score: 0,
        },
        variables: [],
      },
    ],
  }

  beforeEach(() => {
    tester = new ToolTester(responsesTool)
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    test('should construct correct base Typeform API URL', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.typeform.com/forms/form123/responses'
      )
    })

    test('should add pageSize parameter to URL when provided', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
        pageSize: 50,
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.typeform.com/forms/form123/responses?page_size=50'
      )
    })

    test('should add since parameter to URL when provided', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
        since: '2023-01-01T00:00:00Z',
      }

      const url = tester.getRequestUrl(params)
      expect(url).toContain('https://api.typeform.com/forms/form123/responses?since=')
      expect(url).toContain('2023-01-01T00:00:00Z')
    })

    test('should add until parameter to URL when provided', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
        until: '2023-01-31T23:59:59Z',
      }

      const url = tester.getRequestUrl(params)
      expect(url).toContain('https://api.typeform.com/forms/form123/responses?until=')
      expect(url).toContain('2023-01-31T23:59:59Z')
    })

    test('should add completed parameter to URL when provided and not "all"', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
        completed: 'true',
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.typeform.com/forms/form123/responses?completed=true'
      )
    })

    test('should not add completed parameter to URL when set to "all"', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
        completed: 'all',
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.typeform.com/forms/form123/responses'
      )
    })

    test('should combine multiple parameters correctly', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
        pageSize: 10,
        since: '2023-01-01T00:00:00Z',
        until: '2023-01-31T23:59:59Z',
        completed: 'true',
      }

      const url = tester.getRequestUrl(params)
      expect(url).toContain('https://api.typeform.com/forms/form123/responses?')
      expect(url).toContain('page_size=10')
      expect(url).toContain('since=')
      expect(url).toContain('until=')
      expect(url).toContain('completed=true')
    })
  })

  describe('Headers Construction', () => {
    test('should include correct authorization header', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token',
      }

      const headers = tester.getRequestHeaders(params)
      expect(headers.Authorization).toBe('Bearer test-token')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Data Transformation', () => {
    test('should fetch and transform responses correctly', async () => {
      // Setup mock response
      tester.setup(mockResponsesData)

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        apiKey: 'test-token',
      })

      // Check the result
      expect(result.success).toBe(true)
      expect(result.output.total_items).toBe(2)
      expect(result.output.items).toHaveLength(2)
      
      // Check first response
      const firstResponse = result.output.items[0]
      expect(firstResponse.token).toBe('response-id-1')
      expect(firstResponse.answers).toHaveLength(1)
      expect(firstResponse.answers[0].text).toBe('Sample answer')
      
      // Check second response
      const secondResponse = result.output.items[1]
      expect(secondResponse.token).toBe('response-id-2')
    })
  })

  describe('Error Handling', () => {
    test('should handle form not found errors', async () => {
      // Setup 404 error response
      tester.setup({ message: 'Form not found' }, { ok: false, status: 404 })

      // Execute the tool
      const result = await tester.execute({
        formId: 'nonexistent-form',
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toContain('Not Found')
    })

    test('should handle unauthorized errors', async () => {
      // Setup 401 error response
      tester.setup({ message: 'Unauthorized access' }, { ok: false, status: 401 })

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        apiKey: 'invalid-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unauthorized')
    })

    test('should handle network errors', async () => {
      // Setup network error
      tester.setupError('Network error')

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
}) 