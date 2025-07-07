/**
 * Custom error classes for tokenization functionality
 */

export class TokenizationError extends Error {
  public readonly code: 'INVALID_PROVIDER' | 'MISSING_TEXT' | 'CALCULATION_FAILED' | 'INVALID_MODEL'
  public readonly details?: Record<string, unknown>

  constructor(message: string, code: TokenizationError['code'], details?: Record<string, unknown>) {
    super(message)
    this.name = 'TokenizationError'
    this.code = code
    this.details = details
  }
}

export function createTokenizationError(
  code: TokenizationError['code'],
  message: string,
  details?: Record<string, unknown>
): TokenizationError {
  return new TokenizationError(message, code, details)
}
