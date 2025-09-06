/**
 * Utility functions for generating names for all entities (workspaces, folders, workflows)
 */

import type { WorkflowFolder } from '@/stores/folders/store'
import type { Workspace } from '@/stores/organization/types'

export interface NameableEntity {
  name: string
}

interface WorkspacesApiResponse {
  workspaces: Workspace[]
}

interface FoldersApiResponse {
  folders: WorkflowFolder[]
}

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

export function normalizeBlockName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

export function generateUniqueBlockDuplicateName(
  existingNames: string[],
  sourceName: string
): string {
  const normalizedSet = new Set(
    (existingNames || []).filter((n) => typeof n === 'string').map((n) => normalizeBlockName(n))
  )

  const trimmed = (sourceName || '').trim()
  const match = trimmed.match(/^(.*?)(?:\s+(\d+))?$/)
  const baseRaw = match ? match[1] || '' : trimmed
  const base = baseRaw.trim() || 'Block'
  const start = match?.[2] ? Number.parseInt(match[2], 10) + 1 : 1

  let n = start
  while (true) {
    const candidate = `${base} ${n}`
    if (!normalizedSet.has(normalizeBlockName(candidate))) return candidate
    n += 1
  }
}

/**
 * Generates the next incremental name for entities following pattern: "{prefix} {number}"
 *
 * @param existingEntities - Array of entities with name property
 * @param prefix - Prefix for the name (e.g., "Workspace", "Folder", "Subfolder")
 * @returns Next available name (e.g., "Workspace 3")
 */
export function generateIncrementalName<T extends NameableEntity>(
  existingEntities: T[],
  prefix: string
): string {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`)
  const existingNumbers = existingEntities
    .map((entity) => entity.name.match(pattern))
    .filter((match) => match !== null)
    .map((match) => Number.parseInt(match![1], 10))
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1
  return `${prefix} ${nextNumber}`
}

export async function generateWorkspaceName(): Promise<string> {
  const response = await fetch('/api/workspaces')
  const data = (await response.json()) as WorkspacesApiResponse
  const workspaces = data.workspaces || []
  return generateIncrementalName(workspaces, 'Workspace')
}

export async function generateFolderName(workspaceId: string): Promise<string> {
  const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
  const data = (await response.json()) as FoldersApiResponse
  const folders = data.folders || []
  const rootFolders = folders.filter((folder) => folder.parentId === null)
  return generateIncrementalName(rootFolders, 'Folder')
}

export async function generateSubfolderName(
  workspaceId: string,
  parentFolderId: string
): Promise<string> {
  const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
  const data = (await response.json()) as FoldersApiResponse
  const folders = data.folders || []
  const subfolders = folders.filter((folder) => folder.parentId === parentFolderId)
  return generateIncrementalName(subfolders, 'Subfolder')
}

export function generateCreativeWorkflowName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective.toLowerCase()}-${noun.toLowerCase()}`
}
