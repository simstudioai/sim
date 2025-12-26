import Decimal from 'decimal.js'

/**
 * Configure Decimal.js for billing precision.
 * 20 significant digits is more than enough for currency calculations.
 */
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP })

/**
 * Parse a value to Decimal for precise billing calculations.
 * Handles null, undefined, empty strings, and number/string inputs.
 */
export function toDecimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0)
  }
  return new Decimal(value)
}

/**
 * Convert Decimal back to number for storage/API responses.
 * Use this at the final step when returning values.
 */
export function toNumber(value: Decimal): number {
  return value.toNumber()
}

/**
 * Sum an array of values with decimal precision.
 */
export function sumDecimals(values: Array<string | number | null | undefined>): Decimal {
  return values.reduce((acc: Decimal, val) => acc.plus(toDecimal(val)), new Decimal(0))
}

/**
 * Format a Decimal to a fixed string for database storage.
 * Uses 6 decimal places which matches current DB precision.
 */
export function toFixedString(value: Decimal, decimalPlaces = 6): string {
  return value.toFixed(decimalPlaces)
}

export { Decimal }
