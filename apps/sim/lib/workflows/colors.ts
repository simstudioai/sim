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

import { randomItem } from '@sim/utils/random'

/**
 * Full list of available workflow colors with names.
 * Used for color picker and random color assignment.
 *
 * Ordered by hue family (Purple, Blue, Green, Red, Orange, Pink), each
 * with 6 vibrant shades from brightest (1) to darkest (6). This grouping
 * lets the color picker render hue families as columns.
 */
export const WORKFLOW_COLORS = [
  // Purple
  { color: '#c084fc', name: 'Purple 1' },
  { color: '#a855f7', name: 'Purple 2' },
  { color: '#9333ea', name: 'Purple 3' },
  { color: '#8e4cfb', name: 'Purple 4' },
  { color: '#7c3aed', name: 'Purple 5' },
  { color: '#6322c9', name: 'Purple 6' },

  // Blue
  { color: '#5ed8ff', name: 'Blue 1' },
  { color: '#38c8ff', name: 'Blue 2' },
  { color: '#33b4ff', name: 'Blue 3' },
  { color: '#1e9de8', name: 'Blue 4' },
  { color: '#1486d1', name: 'Blue 5' },
  { color: '#0a6fb8', name: 'Blue 6' },

  // Green
  { color: '#4ade80', name: 'Green 1' },
  { color: '#2ed96a', name: 'Green 2' },
  { color: '#22c55e', name: 'Green 3' },
  { color: '#18b04c', name: 'Green 4' },
  { color: '#0e9b3a', name: 'Green 5' },
  { color: '#048628', name: 'Green 6' },

  // Red
  { color: '#ff6b6b', name: 'Red 1' },
  { color: '#ff5555', name: 'Red 2' },
  { color: '#ef4444', name: 'Red 3' },
  { color: '#dc3535', name: 'Red 4' },
  { color: '#c92626', name: 'Red 5' },
  { color: '#b61717', name: 'Red 6' },

  // Orange
  { color: '#fb923c', name: 'Orange 1' },
  { color: '#ff8328', name: 'Orange 2' },
  { color: '#f97316', name: 'Orange 3' },
  { color: '#e56004', name: 'Orange 4' },
  { color: '#d14d00', name: 'Orange 5' },
  { color: '#bd3a00', name: 'Orange 6' },

  // Pink
  { color: '#f472b6', name: 'Pink 1' },
  { color: '#ec4899', name: 'Pink 2' },
  { color: '#e11d89', name: 'Pink 3' },
  { color: '#d61c7a', name: 'Pink 4' },
  { color: '#be185d', name: 'Pink 5' },
  { color: '#9d174d', name: 'Pink 6' },
] as const

/**
 * Generates a random color for a new workflow
 * @returns A hex color string from the available workflow colors
 */
export function getNextWorkflowColor(): string {
  return randomItem(WORKFLOW_COLORS).color
}
