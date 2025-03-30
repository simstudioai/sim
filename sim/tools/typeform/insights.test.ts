/**
 * @vitest-environment jsdom
 *
 * Typeform Insights Tool Unit Tests
 *
 * This file contains unit tests for the Typeform Insights tool,
 * which is used to retrieve form insights and analytics.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToolTester } from '../__test-utils__/test-tools'
import { insightsTool } from './insights'

describe('Typeform Insights Tool', () => {
  let tester: ToolTester

  // Mock insights response
  const mockInsightsData = {
    fields: [
      {
        dropoffs: 5,
        id: 'field123',
        label: '1',
        ref: 'ref123',
        title: 'What is your name?',
        type: 'short_text',
        views: 100
      },
      {
        dropoffs: 10,
        id: 'field456',
        label: '2',
        ref: 'ref456',
        title: 'How did you hear about us?',
        type: 'multiple_choice',
        views: 95
      }
    ],
    form: {
      platforms: [
        {
          average_time: 120000,
          completion_rate: 75.5,
          platform: 'desktop',
          responses_count: 80,
          total_visits: 120,
          unique_visits: 100
        },
        {
          average_time: 180000,
          completion_rate: 65.2,
          platform: 'mobile',
          responses_count: 40,
          total_visits: 60,
          unique_visits: 50
        }
      ],
      summary: {
        average_time: 140000,
        completion_rate: 72.3,
        responses_count: 120,
        total_visits: 180,
        unique_visits: 150
      }
    }
  }

  beforeEach(() => {
    tester = new ToolTester(insightsTool)
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    test('should construct correct URL for insights endpoint', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token'
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.typeform.com/insights/form123/summary'
      )
    })

    test('should handle special characters in form ID', () => {
      const params = {
        formId: 'form/with/special?chars',
        apiKey: 'test-token'
      }

      const url = tester.getRequestUrl(params)
      // Just verify the URL is constructed and doesn't throw errors
      expect(url).toContain('https://api.typeform.com/insights/')
      expect(url).toContain('summary')
    })
  })

  describe('Headers Construction', () => {
    test('should include correct authorization header', () => {
      const params = {
        formId: 'form123',
        apiKey: 'test-token'
      }

      const headers = tester.getRequestHeaders(params)
      expect(headers.Authorization).toBe('Bearer test-token')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Data Transformation', () => {
    test('should transform insights data correctly', async () => {
      // Setup mock response
      tester.setup(mockInsightsData)

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        apiKey: 'test-token'
      })

      // Check the result
      expect(result.success).toBe(true)
      
      // Verify form summary data
      expect(result.output.form.summary.responses_count).toBe(120)
      expect(result.output.form.summary.completion_rate).toBe(72.3)
      
      // Verify platforms data
      expect(result.output.form.platforms).toHaveLength(2)
      expect(result.output.form.platforms[0].platform).toBe('desktop')
      expect(result.output.form.platforms[1].platform).toBe('mobile')
      
      // Verify fields data
      expect(result.output.fields).toHaveLength(2)
      expect(result.output.fields[0].title).toBe('What is your name?')
      expect(result.output.fields[1].title).toBe('How did you hear about us?')
    })
  })

  describe('Error Handling', () => {
    test('should handle form not found errors', async () => {
      // Setup 404 error response
      tester.setup({ message: 'Form not found' }, { ok: false, status: 404 })

      // Execute the tool
      const result = await tester.execute({
        formId: 'nonexistent',
        apiKey: 'test-token'
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
        apiKey: 'invalid-token'
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
        apiKey: 'test-token'
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
}) 