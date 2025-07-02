// Available workflow colors
export const WORKFLOW_COLORS = [
  // Original colors
  '#3972F6', // Blue
  '#F639DD', // Pink/Magenta
  '#F6B539', // Orange/Yellow
  '#8139F6', // Purple
  '#39B54A', // Green
  '#39B5AB', // Teal
  '#F66839', // Red/Orange

  // Additional vibrant blues
  '#2E5BFF', // Bright Blue
  '#4A90FF', // Sky Blue
  '#1E40AF', // Deep Blue
  '#0EA5E9', // Cyan Blue
  '#3B82F6', // Royal Blue
  '#6366F1', // Indigo
  '#1D4ED8', // Electric Blue

  // Additional vibrant purples
  '#A855F7', // Bright Purple
  '#C084FC', // Light Purple
  '#7C3AED', // Deep Purple
  '#9333EA', // Violet
  '#8B5CF6', // Medium Purple
  '#6D28D9', // Dark Purple
  '#5B21B6', // Deep Violet

  // Additional vibrant pinks/magentas
  '#EC4899', // Hot Pink
  '#F97316', // Pink Orange
  '#E11D48', // Rose
  '#BE185D', // Deep Pink
  '#DB2777', // Pink Red
  '#F472B6', // Light Pink
  '#F59E0B', // Amber Pink

  // Additional vibrant greens
  '#10B981', // Emerald
  '#059669', // Green Teal
  '#16A34A', // Forest Green
  '#22C55E', // Lime Green
  '#84CC16', // Yellow Green
  '#65A30D', // Olive Green
  '#15803D', // Dark Green

  // Additional vibrant teals/cyans
  '#06B6D4', // Cyan
  '#0891B2', // Dark Cyan
  '#0E7490', // Teal Blue
  '#14B8A6', // Turquoise
  '#0D9488', // Dark Teal
  '#047857', // Sea Green
  '#059669', // Mint Green

  // Additional vibrant oranges/reds
  '#EA580C', // Bright Orange
  '#DC2626', // Red
  '#B91C1C', // Dark Red
  '#EF4444', // Light Red
  '#F97316', // Orange
  '#FB923C', // Light Orange
  '#FDBA74', // Peach

  // Additional vibrant yellows/golds
  '#FBBF24', // Gold
  '#F59E0B', // Amber
  '#D97706', // Dark Amber
  '#92400E', // Bronze
  '#EAB308', // Yellow
  '#CA8A04', // Dark Yellow
  '#A16207', // Mustard

  // Additional unique vibrant colors
  '#FF6B6B', // Coral
  '#4ECDC4', // Mint
  '#45B7D1', // Light Blue
  '#96CEB4', // Sage
  '#FFEAA7', // Cream
  '#DDA0DD', // Plum
  '#98D8C8', // Seafoam
  '#F7DC6F', // Banana
  '#BB8FCE', // Lavender
  '#85C1E9', // Baby Blue
  '#F8C471', // Peach
  '#82E0AA', // Light Green
  '#F1948A', // Salmon
  '#D7BDE2', // Lilac
  '#D7BDE2', // Lilac
]

// Random adjectives and nouns for generating creative workflow names
const ADJECTIVES = [
  'Blazing',
  'Crystal',
  'Golden',
  'Silver',
  'Mystic',
  'Cosmic',
  'Electric',
  'Frozen',
  'Burning',
  'Shining',
  'Dancing',
  'Flying',
  'Roaring',
  'Whispering',
  'Glowing',
  'Sparkling',
  'Thunder',
  'Lightning',
  'Storm',
  'Ocean',
  'Mountain',
  'Forest',
  'Desert',
  'Arctic',
  'Tropical',
  'Midnight',
  'Dawn',
  'Sunset',
  'Rainbow',
  'Diamond',
  'Ruby',
  'Emerald',
  'Sapphire',
  'Pearl',
  'Jade',
  'Amber',
  'Coral',
  'Ivory',
  'Obsidian',
  'Marble',
  'Velvet',
  'Silk',
  'Satin',
  'Linen',
  'Cotton',
  'Wool',
  'Cashmere',
  'Denim',
  'Neon',
  'Pastel',
  'Vibrant',
  'Muted',
  'Bold',
  'Subtle',
  'Bright',
  'Dark',
]

const NOUNS = [
  'Phoenix',
  'Dragon',
  'Eagle',
  'Wolf',
  'Lion',
  'Tiger',
  'Panther',
  'Falcon',
  'Hawk',
  'Raven',
  'Swan',
  'Dove',
  'Butterfly',
  'Firefly',
  'Dragonfly',
  'Hummingbird',
  'Galaxy',
  'Nebula',
  'Comet',
  'Meteor',
  'Star',
  'Moon',
  'Sun',
  'Planet',
  'Asteroid',
  'Constellation',
  'Aurora',
  'Eclipse',
  'Solstice',
  'Equinox',
  'Horizon',
  'Zenith',
  'Castle',
  'Tower',
  'Bridge',
  'Garden',
  'Fountain',
  'Palace',
  'Temple',
  'Cathedral',
  'Lighthouse',
  'Windmill',
  'Waterfall',
  'Canyon',
  'Valley',
  'Peak',
  'Ridge',
  'Cliff',
  'Ocean',
  'River',
  'Lake',
  'Stream',
  'Pond',
  'Bay',
  'Cove',
  'Harbor',
  'Island',
  'Peninsula',
  'Archipelago',
  'Atoll',
  'Reef',
  'Lagoon',
  'Fjord',
  'Delta',
  'Cake',
  'Cookie',
  'Muffin',
  'Cupcake',
  'Pie',
  'Tart',
  'Brownie',
  'Donut',
  'Pancake',
  'Waffle',
  'Croissant',
  'Bagel',
  'Pretzel',
  'Biscuit',
  'Scone',
  'Crumpet',
]

// Generates a random name for a new workflow
export function generateUniqueName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective.toLowerCase()}-${noun.toLowerCase()}`
}

// Generates a random color for a new workflow
export function getNextWorkflowColor(): string {
  // Simply return a random color from the available colors
  return WORKFLOW_COLORS[Math.floor(Math.random() * WORKFLOW_COLORS.length)]
}
