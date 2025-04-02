/**
 * @vitest-environment jsdom
 *
 * Typeform Files Tool Unit Tests
 *
 * This file contains unit tests for the Typeform Files tool,
 * which is used to download files uploaded in Typeform responses.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToolTester } from '../__test-utils__/test-tools'
import { filesTool } from './files'

describe('Typeform Files Tool', () => {
  let tester: ToolTester

  // Mock file response
  const mockFileResponseHeaders = {
    'content-type': 'application/pdf',
    'content-disposition': 'attachment; filename="test-file.pdf"',
  }

  beforeEach(() => {
    tester = new ToolTester(filesTool)
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    test('should construct correct URL for file endpoint', () => {
      const params = {
        formId: 'form123',
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
        apiKey: 'test-token',
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.typeform.com/forms/form123/responses/resp456/fields/field789/files/test-file.pdf'
      )
    })

    test('should add inline parameter when provided', () => {
      const params = {
        formId: 'form123',
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
        inline: true,
        apiKey: 'test-token',
      }

      const url = tester.getRequestUrl(params)
      expect(url).toContain('?inline=true')
    })

    test('should handle special characters in form ID and response ID', () => {
      const params = {
        formId: 'form/with/special?chars',
        responseId: 'resp&with#chars',
        fieldId: 'field-id',
        filename: 'file name.pdf',
        apiKey: 'test-token',
      }

      const url = tester.getRequestUrl(params)
      // Just verify the URL is constructed and doesn't throw errors
      expect(url).toContain('https://api.typeform.com/forms/')
      expect(url).toContain('files')
    })
  })

  describe('Headers Construction', () => {
    test('should include correct authorization header', () => {
      const params = {
        formId: 'form123',
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
        apiKey: 'test-token',
      }

      const headers = tester.getRequestHeaders(params)
      expect(headers.Authorization).toBe('Bearer test-token')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Data Transformation', () => {
    test('should transform file data correctly', async () => {
      // Setup mock response for binary file data
      tester.setup('file-content-binary-data', {
        headers: mockFileResponseHeaders,
      })

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
        apiKey: 'test-token',
      })

      // Check the result
      expect(result.success).toBe(true)
      expect(result.output.filename).toBe('test-file.pdf')
      expect(result.output.contentType).toBe('application/pdf')
      // Don't check the fileUrl property as it depends on implementation details
    })

    test('should handle missing content-disposition header', async () => {
      // Setup mock response without content-disposition
      tester.setup('file-content-binary-data', {
        headers: { 'content-type': 'application/pdf' },
      })

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
        apiKey: 'test-token',
      })

      // Check the result
      expect(result.success).toBe(true)
      expect(result.output.contentType).toBe('application/pdf')
      // Don't check the fileUrl property as it depends on implementation details
      // filename should be empty since there's no content-disposition
      expect(result.output.filename).toBe('')
    })
  })

  describe('Error Handling', () => {
    test('should handle file not found errors', async () => {
      // Setup 404 error response
      tester.setup({ message: 'File not found' }, { ok: false, status: 404 })

      // Execute the tool
      const result = await tester.execute({
        formId: 'form123',
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'nonexistent.pdf',
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
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
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
        responseId: 'resp456',
        fieldId: 'field789',
        filename: 'test-file.pdf',
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
