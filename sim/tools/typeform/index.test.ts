/**
 * @vitest-environment jsdom
 *
 * Typeform Integration Tests
 *
 * This file contains integration tests that verify the Typeform tools
 * work correctly together and can be properly used from the block.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typeformFilesTool, typeformResponsesTool, typeformInsightsTool } from './index'
import { ToolTester } from '../__test-utils__/test-tools'

describe('Typeform Tools Integration', () => {
  describe('Typeform Responses Tool Export', () => {
    let tester: ToolTester
    
    beforeEach(() => {
      tester = new ToolTester(typeformResponsesTool)
    })
    
    afterEach(() => {
      tester.cleanup()
      vi.resetAllMocks()
    })
    
    test('should use the correct tool ID', () => {
      expect(typeformResponsesTool.id).toBe('typeform_responses')
    })
    
    test('should handle basic responses request', async () => {
      // Setup mock response data
      const mockData = {
        total_items: 1,
        page_count: 1,
        items: [
          {
            landing_id: 'test-landing',
            token: 'test-token',
            submitted_at: '2023-01-01T00:00:00Z',
            answers: [],
          },
        ],
      }
      
      tester.setup(mockData)
      
      // Execute the tool
      const result = await tester.execute({
        formId: 'test-form',
        apiKey: 'test-api-key',
      })
      
      expect(result.success).toBe(true)
      expect(result.output.total_items).toBe(1)
    })
  })
  
  describe('Typeform Files Tool Export', () => {
    let tester: ToolTester
    
    beforeEach(() => {
      tester = new ToolTester(typeformFilesTool)
    })
    
    afterEach(() => {
      tester.cleanup()
      vi.resetAllMocks()
    })
    
    test('should use the correct tool ID', () => {
      expect(typeformFilesTool.id).toBe('typeform_files')
    })
    
    test('should handle basic file request', async () => {
      // Setup mock response with file headers
      tester.setup('binary-file-content', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="test.pdf"'
        }
      })
      
      // Execute the tool
      const result = await tester.execute({
        formId: 'test-form',
        responseId: 'test-response',
        fieldId: 'test-field',
        filename: 'test.pdf',
        apiKey: 'test-api-key',
      })
      
      expect(result.success).toBe(true)
      expect(result.output.contentType).toBe('application/pdf')
      expect(result.output.filename).toBe('test.pdf')
    })
  })
  
  describe('Typeform Insights Tool Export', () => {
    let tester: ToolTester
    
    beforeEach(() => {
      tester = new ToolTester(typeformInsightsTool)
    })
    
    afterEach(() => {
      tester.cleanup()
      vi.resetAllMocks()
    })
    
    test('should use the correct tool ID', () => {
      expect(typeformInsightsTool.id).toBe('typeform_insights')
    })
    
    test('should handle basic insights request', async () => {
      // Setup mock response data
      const mockData = {
        fields: [
          {
            dropoffs: 5,
            id: 'field123',
            label: '1',
            ref: 'ref123',
            title: 'What is your name?',
            type: 'short_text',
            views: 100
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
      
      tester.setup(mockData)
      
      // Execute the tool
      const result = await tester.execute({
        formId: 'test-form',
        apiKey: 'test-api-key',
      })
      
      expect(result.success).toBe(true)
      expect(result.output.form.summary.responses_count).toBe(120)
      expect(result.output.fields).toHaveLength(1)
    })
  })
  
  describe('End-to-End Flow', () => {
    // This test simulates using both tools together in a workflow
    
    test('should be able to get responses and then file', async () => {
      // First set up responses tester
      const responsesTester = new ToolTester(typeformResponsesTool)
      
      // Mock responses data with a file upload
      const mockResponsesData = {
        total_items: 1,
        page_count: 1,
        items: [
          {
            landing_id: 'landing-id',
            token: 'response-id',
            submitted_at: '2023-01-01T00:00:00Z',
            answers: [
              {
                field: {
                  id: 'file-field',
                  type: 'file_upload',
                },
                type: 'file_url',
                file_url: 'https://example.com/placeholder.pdf',
              },
            ],
          },
        ],
      }
      
      responsesTester.setup(mockResponsesData)
      
      // Get responses
      const responsesResult = await responsesTester.execute({
        formId: 'test-form',
        apiKey: 'test-api-key',
      })
      
      expect(responsesResult.success).toBe(true)
      
      // Now get the response ID and field ID
      const responseId = responsesResult.output.items[0].token
      expect(responseId).toBe('response-id')
      
      const fieldId = responsesResult.output.items[0].answers[0].field.id
      expect(fieldId).toBe('file-field')
      
      // Now set up files tester
      const filesTester = new ToolTester(typeformFilesTool)
      
      // Mock file data
      filesTester.setup('binary-file-data', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="uploaded.pdf"'
        }
      })
      
      // Get file using the response ID and field ID from previous request
      const filesResult = await filesTester.execute({
        formId: 'test-form',
        responseId,
        fieldId,
        filename: 'uploaded.pdf',
        apiKey: 'test-api-key',
      })
      
      expect(filesResult.success).toBe(true)
      expect(filesResult.output.contentType).toBe('application/pdf')
      expect(filesResult.output.filename).toBe('uploaded.pdf')
      
      // Clean up
      responsesTester.cleanup()
      filesTester.cleanup()
    })
    
    test('should be able to get responses and then insights', async () => {
      // First set up responses tester
      const responsesTester = new ToolTester(typeformResponsesTool)
      
      // Mock responses data
      const mockResponsesData = {
        total_items: 10,
        page_count: 1,
        items: [
          {
            landing_id: 'landing-id',
            token: 'response-id',
            submitted_at: '2023-01-01T00:00:00Z',
            answers: [],
          },
        ],
      }
      
      responsesTester.setup(mockResponsesData)
      
      // Get responses
      const responsesResult = await responsesTester.execute({
        formId: 'test-form',
        apiKey: 'test-api-key',
      })
      
      expect(responsesResult.success).toBe(true)
      expect(responsesResult.output.total_items).toBe(10)
      
      // Now set up insights tester
      const insightsTester = new ToolTester(typeformInsightsTool)
      
      // Mock insights data
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
      
      insightsTester.setup(mockInsightsData)
      
      // Get insights for the same form
      const insightsResult = await insightsTester.execute({
        formId: 'test-form',
        apiKey: 'test-api-key',
      })
      
      expect(insightsResult.success).toBe(true)
      expect(insightsResult.output.form.summary.responses_count).toBe(120)
      
      // Verify we can analyze the data by looking at completion rates
      expect(insightsResult.output.form.summary.completion_rate).toBe(72.3)
      expect(insightsResult.output.form.platforms[0].platform).toBe('desktop')
      
      // Clean up
      responsesTester.cleanup()
      insightsTester.cleanup()
    })
  })
}) 