/**
 * Workflow color constants and utilities.
 * Centralized location for all workflow color-related functionality.
 *
 * Colors are aligned with the brand color scheme:
 * - Purple: brand-400 (#8e4cfb)
 * - Blue: brand-secondary (#33b4ff)
 * - Green: brand-tertiary (#22c55e)
 * - Red: text-error (#ef4444)
 * - Orange: warning (#f97316)
 * - Pink: (#ec4899)
 */

/**
 * Full list of available workflow colors with names.
 * Used for color picker and random color assignment.
 * Each base color has 6 vibrant shades optimized for both light and dark themes.
 */
export const WORKFLOW_COLORS = [
  // Shade 1 - all base colors (brightest)
  { color: '#c084fc', name: 'Purple 1' },
  { color: '#5ed8ff', name: 'Blue 1' },
  { color: '#4aea7f', name: 'Green 1' },
  { color: '#ff6b6b', name: 'Red 1' },
  { color: '#ff9642', name: 'Orange 1' },
  { color: '#f472b6', name: 'Pink 1' },

  // Shade 2 - all base colors
  { color: '#a855f7', name: 'Purple 2' },
  { color: '#38c8ff', name: 'Blue 2' },
  { color: '#2ed96a', name: 'Green 2' },
  { color: '#ff5555', name: 'Red 2' },
  { color: '#ff8328', name: 'Orange 2' },
  { color: '#ec4899', name: 'Pink 2' },

  // Shade 3 - all base colors
  { color: '#9333ea', name: 'Purple 3' },
  { color: '#33b4ff', name: 'Blue 3' },
  { color: '#22c55e', name: 'Green 3' },
  { color: '#ef4444', name: 'Red 3' },
  { color: '#f97316', name: 'Orange 3' },
  { color: '#e11d89', name: 'Pink 3' },

  // Shade 4 - all base colors
  { color: '#8e4cfb', name: 'Purple 4' },
  { color: '#1e9de8', name: 'Blue 4' },
  { color: '#18b04c', name: 'Green 4' },
  { color: '#dc3535', name: 'Red 4' },
  { color: '#e56004', name: 'Orange 4' },
  { color: '#d61c7a', name: 'Pink 4' },

  // Shade 5 - all base colors
  { color: '#7c3aed', name: 'Purple 5' },
  { color: '#1486d1', name: 'Blue 5' },
  { color: '#0e9b3a', name: 'Green 5' },
  { color: '#c92626', name: 'Red 5' },
  { color: '#d14d00', name: 'Orange 5' },
  { color: '#be185d', name: 'Pink 5' },

  // Shade 6 - all base colors (darkest)
  { color: '#6322c9', name: 'Purple 6' },
  { color: '#0a6fb8', name: 'Blue 6' },
  { color: '#048628', name: 'Green 6' },
  { color: '#b61717', name: 'Red 6' },
  { color: '#bd3a00', name: 'Orange 6' },
  { color: '#9d174d', name: 'Pink 6' },
] as const

/**
 * Generates a random color for a new workflow
 * @returns A hex color string from the available workflow colors
 */
export function getNextWorkflowColor(): string {
  return WORKFLOW_COLORS[Math.floor(Math.random() * WORKFLOW_COLORS.length)].color
}
