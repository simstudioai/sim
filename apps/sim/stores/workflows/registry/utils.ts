// Available workflow colors
export const WORKFLOW_COLORS = [
  // Blues - vibrant blue tones
  '#3972F6', // Blue (original)
  '#2E5BF5', // Deeper Blue
  '#1E4BF4', // Royal Blue
  '#0D3BF3', // Deep Royal Blue

  // Pinks/Magentas - vibrant pink and magenta tones
  '#F639DD', // Pink/Magenta (original)
  '#F529CF', // Deep Magenta
  '#F749E7', // Light Magenta
  '#F419C1', // Hot Pink

  // Oranges/Yellows - vibrant orange and yellow tones
  '#F6B539', // Orange/Yellow (original)
  '#F5A529', // Deep Orange
  '#F49519', // Burnt Orange
  '#F38509', // Deep Burnt Orange

  // Purples - vibrant purple tones
  '#8139F6', // Purple (original)
  '#7129F5', // Deep Purple
  '#6119F4', // Royal Purple
  '#5109F3', // Deep Royal Purple

  // Greens - vibrant green tones
  '#39B54A', // Green (original)
  '#29A53A', // Deep Green
  '#19952A', // Forest Green
  '#09851A', // Deep Forest Green

  // Teals/Cyans - vibrant teal and cyan tones
  '#39B5AB', // Teal (original)
  '#29A59B', // Deep Teal
  '#19958B', // Dark Teal
  '#09857B', // Deep Dark Teal

  // Reds/Red-Oranges - vibrant red and red-orange tones
  '#F66839', // Red/Orange (original)
  '#F55829', // Deep Red-Orange
  '#F44819', // Burnt Red
  '#F33809', // Deep Burnt Red

  // Additional vibrant colors for variety
  // Corals - warm coral tones
  '#F6397A', // Coral
  '#F5296A', // Deep Coral
  '#F7498A', // Light Coral

  // Crimsons - deep red tones
  '#DC143C', // Crimson
  '#CC042C', // Deep Crimson
  '#EC243C', // Light Crimson
  '#BC003C', // Dark Crimson
  '#FC343C', // Bright Crimson

  // Mint - fresh green tones
  '#00FF7F', // Mint Green
  '#00EF6F', // Deep Mint
  '#00DF5F', // Dark Mint

  // Slate - blue-gray tones
  '#6A5ACD', // Slate Blue
  '#5A4ABD', // Deep Slate
  '#4A3AAD', // Dark Slate

  // Amber - warm orange-yellow tones
  '#FFBF00', // Amber
  '#EFAF00', // Deep Amber
  '#DF9F00', // Dark Amber
]

// Generates a random color for a new workflow
export function getNextWorkflowColor(): string {
  // Simply return a random color from the available colors
  return WORKFLOW_COLORS[Math.floor(Math.random() * WORKFLOW_COLORS.length)]
}
