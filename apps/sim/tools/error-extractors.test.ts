import { describe, expect, it } from 'vitest'
import { ErrorExtractorId, type ErrorInfo, extractErrorMessage } from './error-extractors'

describe('Error Extractors', () => {
  describe('extractErrorMessage', () => {
    it('should extract GraphQL error messages', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          errors: [{ message: 'GraphQL validation error' }],
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('GraphQL validation error')
    })

    it('should extract Twitter API error details', () => {
      const errorInfo: ErrorInfo = {
        status: 403,
        data: {
          errors: [{ detail: 'Rate limit exceeded' }],
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('Rate limit exceeded')
    })

    it('should extract Telegram API description', () => {
      const errorInfo: ErrorInfo = {
        status: 403,
        data: {
          ok: false,
          error_code: 403,
          description: "Forbidden: bots can't send messages to bots",
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe("Forbidden: bots can't send messages to bots")
    })

    it('should extract standard message field', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          message: 'Invalid request parameters',
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('Invalid request parameters')
    })

    it('should extract OAuth error_description', () => {
      const errorInfo: ErrorInfo = {
        status: 401,
        data: {
          error: 'invalid_grant',
          error_description: 'The provided authorization grant is invalid',
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('The provided authorization grant is invalid')
    })

    it('should extract SOAP fault strings', () => {
      const errorInfo: ErrorInfo = {
        status: 500,
        data: {
          fault: {
            faultstring: 'SOAP processing error',
          },
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('SOAP processing error')
    })

    it('should extract nested error object messages', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          error: {
            message: 'Resource not found',
          },
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('Resource not found')
    })

    it('should handle string error field', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          error: 'Bad request',
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('Bad request')
    })

    it('should extract errors array with strings', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          errors: ['Email is required', 'Password is too short'],
        },
      }
      expect(extractErrorMessage(errorInfo)).toBe('Email is required')
    })

    it('should use HTTP status text as fallback', () => {
      const errorInfo: ErrorInfo = {
        status: 404,
        statusText: 'Not Found',
        data: {},
      }
      expect(extractErrorMessage(errorInfo)).toBe('Not Found')
    })

    it('should use final fallback when no pattern matches', () => {
      const errorInfo: ErrorInfo = {
        status: 500,
        data: {},
      }
      expect(extractErrorMessage(errorInfo)).toBe('Request failed with status 500')
    })

    it('should handle undefined errorInfo', () => {
      expect(extractErrorMessage(undefined)).toBe('Request failed with status unknown')
    })

    it('should handle empty strings gracefully', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          message: '',
        },
      }
      // Should skip empty message and use fallback
      expect(extractErrorMessage(errorInfo)).toBe('Request failed with status 400')
    })
  })

  describe('extractErrorMessage with explicit extractorId', () => {
    it('should use specified extractor directly (deterministic)', () => {
      const errorInfo: ErrorInfo = {
        status: 403,
        data: {
          description: "Forbidden: bots can't send messages to bots",
          message: 'Some other message',
        },
      }

      // With explicit extractor ID, should use Telegram extractor
      expect(extractErrorMessage(errorInfo, ErrorExtractorId.TELEGRAM_DESCRIPTION)).toBe(
        "Forbidden: bots can't send messages to bots"
      )
    })

    it('should use specified extractor even when other patterns match first', () => {
      const errorInfo: ErrorInfo = {
        status: 400,
        data: {
          errors: [{ message: 'GraphQL error' }], // This would match first normally
          message: 'Standard message', // Explicitly request this one
        },
      }

      // With explicit ID, should skip GraphQL and use standard message
      expect(extractErrorMessage(errorInfo, ErrorExtractorId.STANDARD_MESSAGE)).toBe(
        'Standard message'
      )
    })

    it('should fallback when specified extractor does not find message', () => {
      const errorInfo: ErrorInfo = {
        status: 404,
        data: {
          someOtherField: 'value',
        },
      }

      // Telegram extractor won't find anything, should fallback
      expect(extractErrorMessage(errorInfo, ErrorExtractorId.TELEGRAM_DESCRIPTION)).toBe(
        'Request failed with status 404'
      )
    })

    it('should warn and fallback for non-existent extractor ID', () => {
      const errorInfo: ErrorInfo = {
        status: 500,
        data: {
          message: 'Error message',
        },
      }

      // Non-existent extractor should fallback
      expect(extractErrorMessage(errorInfo, 'non-existent-extractor')).toBe(
        'Request failed with status 500'
      )
    })
  })
})
