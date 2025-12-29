import { createLogger } from '@sim/logger'

const logger = createLogger('FinancialValidation')

/**
 * Validation options for financial amounts
 */
export interface AmountValidationOptions {
  /** Field name for error messages */
  fieldName?: string
  /** Allow negative amounts (for refunds, credits) */
  allowNegative?: boolean
  /** Allow zero amounts */
  allowZero?: boolean
  /** Minimum allowed amount (inclusive) */
  min?: number
  /** Maximum allowed amount (inclusive) */
  max?: number
  /** Currency code for context */
  currency?: string
  /** Require amount to be specified */
  required?: boolean
}

/**
 * Result of amount validation
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  sanitized?: number
}

/**
 * Validates a financial amount with comprehensive checks
 *
 * @param amount - The amount to validate
 * @param options - Validation options
 * @returns Validation result with sanitized amount if valid
 *
 * @example
 * ```typescript
 * const result = validateFinancialAmount(100.50, {
 *   fieldName: 'invoice amount',
 *   min: 0.01,
 *   max: 100000,
 * })
 * if (!result.valid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateFinancialAmount(
  amount: number | string | undefined | null,
  options: AmountValidationOptions = {}
): ValidationResult {
  const {
    fieldName = 'amount',
    allowNegative = false,
    allowZero = false,
    min,
    max = 10000000, // Default max: $10M
    currency = 'USD',
    required = true,
  } = options

  // Check for undefined/null
  if (amount === undefined || amount === null) {
    if (required) {
      return {
        valid: false,
        error: `${fieldName} is required`,
      }
    }
    return { valid: true }
  }

  // Convert to number if string
  let numAmount: number
  if (typeof amount === 'string') {
    // Remove currency symbols and commas
    const cleaned = amount.replace(/[$,\s]/g, '')
    numAmount = Number.parseFloat(cleaned)

    if (Number.isNaN(numAmount)) {
      return {
        valid: false,
        error: `${fieldName} must be a valid number`,
      }
    }
  } else {
    numAmount = amount
  }

  // Check for NaN and Infinity
  if (!Number.isFinite(numAmount)) {
    return {
      valid: false,
      error: `${fieldName} must be a finite number`,
    }
  }

  // Check for negative
  if (numAmount < 0 && !allowNegative) {
    logger.warn(`Negative amount rejected for ${fieldName}`, {
      amount: numAmount,
      currency,
    })
    return {
      valid: false,
      error: `${fieldName} cannot be negative`,
    }
  }

  // Check for zero
  if (numAmount === 0 && !allowZero) {
    return {
      valid: false,
      error: `${fieldName} cannot be zero`,
    }
  }

  // Check minimum
  if (min !== undefined && numAmount < min) {
    return {
      valid: false,
      error: `${fieldName} must be at least ${formatCurrency(min, currency)}`,
    }
  }

  // Check maximum
  if (max !== undefined && numAmount > max) {
    logger.warn(`Amount exceeds maximum for ${fieldName}`, {
      amount: numAmount,
      max,
      currency,
    })
    return {
      valid: false,
      error: `${fieldName} cannot exceed ${formatCurrency(max, currency)}`,
    }
  }

  // Round to 2 decimal places for currency precision
  const sanitized = Math.round(numAmount * 100) / 100

  // Warn if rounding occurred
  if (sanitized !== numAmount) {
    logger.info(`Amount rounded for currency precision`, {
      original: numAmount,
      sanitized,
      fieldName,
    })
  }

  return {
    valid: true,
    sanitized,
  }
}

/**
 * Validates a date string in YYYY-MM-DD format
 *
 * @param date - The date string to validate
 * @param options - Validation options
 * @returns Validation result with sanitized date if valid
 */
export function validateDate(
  date: string | undefined | null,
  options: {
    fieldName?: string
    required?: boolean
    minDate?: Date
    maxDate?: Date
    allowPast?: boolean
    allowFuture?: boolean
  } = {}
): ValidationResult {
  const {
    fieldName = 'date',
    required = true,
    minDate,
    maxDate,
    allowPast = true,
    allowFuture = true,
  } = options

  // Check for undefined/null
  if (date === undefined || date === null || date === '') {
    if (required) {
      return {
        valid: false,
        error: `${fieldName} is required`,
      }
    }
    return { valid: true }
  }

  // Validate format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(date)) {
    return {
      valid: false,
      error: `${fieldName} must be in YYYY-MM-DD format`,
    }
  }

  // Parse date
  const parsedDate = new Date(date)
  if (Number.isNaN(parsedDate.getTime())) {
    return {
      valid: false,
      error: `${fieldName} is not a valid date`,
    }
  }

  // Check if date matches input (catches invalid dates like 2024-02-30)
  const [year, month, day] = date.split('-').map(Number)
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() + 1 !== month ||
    parsedDate.getUTCDate() !== day
  ) {
    return {
      valid: false,
      error: `${fieldName} is not a valid calendar date`,
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Check past/future restrictions
  if (!allowPast && parsedDate < today) {
    return {
      valid: false,
      error: `${fieldName} cannot be in the past`,
    }
  }

  if (!allowFuture && parsedDate > today) {
    return {
      valid: false,
      error: `${fieldName} cannot be in the future`,
    }
  }

  // Check min/max dates
  if (minDate && parsedDate < minDate) {
    return {
      valid: false,
      error: `${fieldName} cannot be before ${formatDate(minDate)}`,
    }
  }

  if (maxDate && parsedDate > maxDate) {
    return {
      valid: false,
      error: `${fieldName} cannot be after ${formatDate(maxDate)}`,
    }
  }

  return {
    valid: true,
    sanitized: date,
  }
}

/**
 * Formats a number as currency
 */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Formats a date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Validates multiple financial amounts at once
 * Useful for line items, invoices with multiple charges, etc.
 *
 * @param amounts - Array of amounts to validate
 * @param options - Validation options applied to all amounts
 * @returns Array of validation results
 */
export function validateFinancialAmounts(
  amounts: Array<number | string | undefined | null>,
  options: AmountValidationOptions = {}
): ValidationResult[] {
  return amounts.map((amount, index) =>
    validateFinancialAmount(amount, {
      ...options,
      fieldName: `${options.fieldName || 'amount'}[${index}]`,
    })
  )
}
