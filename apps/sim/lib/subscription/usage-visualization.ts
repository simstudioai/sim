/**
 * Shared utilities for consistent usage visualization across the application.
 *
 * This module provides a single source of truth for how usage metrics are
 * displayed visually through "pills" or progress indicators.
 */

/**
 * Number of pills to display in usage indicators.
 *
 * Using 8 pills provides:
 * - 12.5% granularity per pill
 * - Good balance between precision and visual clarity
 * - Consistent representation across panel and settings
 */
export const USAGE_PILL_COUNT = 8

/**
 * Color values for usage pill states
 */
export const USAGE_PILL_COLORS = {
  /** Unfilled pill color (gray) */
  UNFILLED: '#414141',
  /** Normal filled pill color (blue) */
  FILLED: '#34B5FF',
  /** Warning/limit reached pill color (red) */
  AT_LIMIT: '#ef4444',
} as const

/**
 * Calculate the number of filled pills based on usage percentage.
 *
 * Uses Math.ceil() to ensure even minimal usage (0.01%) shows visual feedback.
 * This provides better UX by making it clear that there is some usage, even if small.
 *
 * @param percentUsed - The usage percentage (0-100). Can be a decimal (e.g., 0.315 for 0.315%)
 * @returns Number of pills that should be filled (0 to USAGE_PILL_COUNT)
 *
 * @example
 * calculateFilledPills(0.315)  // Returns 1 (shows feedback for 0.315% usage)
 * calculateFilledPills(50)     // Returns 4 (50% of 8 pills)
 * calculateFilledPills(100)    // Returns 8 (completely filled)
 * calculateFilledPills(150)    // Returns 8 (clamped to maximum)
 */
export function calculateFilledPills(percentUsed: number): number {
  // Clamp percentage to valid range [0, 100]
  const safePercent = Math.min(Math.max(percentUsed, 0), 100)

  // Calculate filled pills using ceil to show feedback for any usage
  return Math.ceil((safePercent / 100) * USAGE_PILL_COUNT)
}

/**
 * Determine if usage has reached the limit (all pills filled).
 *
 * @param percentUsed - The usage percentage (0-100)
 * @returns true if all pills should be filled (at or over limit)
 */
export function isUsageAtLimit(percentUsed: number): boolean {
  return calculateFilledPills(percentUsed) >= USAGE_PILL_COUNT
}

/**
 * Get the appropriate color for a pill based on its state.
 *
 * @param isFilled - Whether this pill should be filled
 * @param isAtLimit - Whether usage has reached the limit
 * @returns Hex color string
 */
export function getPillColor(isFilled: boolean, isAtLimit: boolean): string {
  if (!isFilled) return USAGE_PILL_COLORS.UNFILLED
  if (isAtLimit) return USAGE_PILL_COLORS.AT_LIMIT
  return USAGE_PILL_COLORS.FILLED
}

/**
 * Generate an array of pill states for rendering.
 *
 * @param percentUsed - The usage percentage (0-100)
 * @returns Array of pill states with colors
 *
 * @example
 * const pills = generatePillStates(50)
 * pills.forEach((pill, index) => (
 *   <Pill key={index} color={pill.color} filled={pill.filled} />
 * ))
 */
export function generatePillStates(percentUsed: number): Array<{
  filled: boolean
  color: string
  index: number
}> {
  const filledCount = calculateFilledPills(percentUsed)
  const atLimit = isUsageAtLimit(percentUsed)

  return Array.from({ length: USAGE_PILL_COUNT }, (_, index) => {
    const filled = index < filledCount
    return {
      filled,
      color: getPillColor(filled, atLimit),
      index,
    }
  })
}
