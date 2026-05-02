/**
 * Utility functions for generating names for workspaces and folders
 */

import { requestJson } from '@/lib/api/client/request'
import { type FolderApi, listFoldersContract } from '@/lib/api/contracts/folders'

export interface NameableEntity {
  name: string
}

const WORKSPACE_NOUNS = [
  'Pulsar',
  'Quasar',
  'Nebula',
  'Nova',
  'Cosmos',
  'Orion',
  'Vega',
  'Zenith',
  'Horizon',
  'Eclipse',
  'Aurora',
  'Photon',
  'Vertex',
  'Nexus',
  'Solaris',
  'Andromeda',
  'Phoenix',
  'Polaris',
  'Sirius',
  'Altair',
  'Meridian',
  'Titan',
  'Apex',
  'Aether',
  'Voyager',
  'Beacon',
  'Sentinel',
  'Pioneer',
  'Equinox',
  'Solstice',
  'Corona',
  'Stellar',
  'Helix',
  'Prism',
  'Axiom',
  'Boson',
  'Cygnus',
  'Draco',
  'Lyra',
  'Aquila',
  'Perseus',
  'Pegasus',
  'Triton',
  'Callisto',
  'Europa',
  'Oberon',
  'Tachyon',
  'Neutron',
  'Graviton',
  'Parallax',
] as const

/**
 * Generates the next incremental name for entities following pattern: "{prefix} {number}"
 *
 * @param existingEntities - Array of entities with name property
 * @param prefix - Prefix for the name (e.g., "Folder", "Subfolder")
 * @returns Next available name (e.g., "Folder 3")
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

/**
 * Generates a random cosmos-themed workspace name
 */
export function generateWorkspaceName(): string {
  return WORKSPACE_NOUNS[Math.floor(Math.random() * WORKSPACE_NOUNS.length)]
}

async function fetchWorkspaceFolders(workspaceId: string): Promise<FolderApi[]> {
  const { folders } = await requestJson(listFoldersContract, {
    query: { workspaceId },
  })
  return folders
}

/**
 * Generates the next folder name for a workspace
 */
export async function generateFolderName(workspaceId: string): Promise<string> {
  const folders = await fetchWorkspaceFolders(workspaceId)

  const rootFolders = folders.filter((folder) => folder.parentId === null)

  return generateIncrementalName(rootFolders, 'Folder')
}

/**
 * Generates the next subfolder name for a parent folder
 */
export async function generateSubfolderName(
  workspaceId: string,
  parentFolderId: string
): Promise<string> {
  const folders = await fetchWorkspaceFolders(workspaceId)

  const subfolders = folders.filter((folder) => folder.parentId === parentFolderId)

  return generateIncrementalName(subfolders, 'Subfolder')
}
