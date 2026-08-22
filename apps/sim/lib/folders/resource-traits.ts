import type { FolderResourceType } from '@/lib/api/contracts/folders'

/**
 * The cheap, declarative facts about a folder resource type.
 *
 * Deliberately a leaf module. {@link folderResourceConfig} in `./config` owns
 * everything else a resource type needs — child tables, archive and restore
 * sets, delete guards — and to do that it imports the db schema for every table
 * it serves, which transitively reaches the executor and the tool registry.
 * Pulling that graph in to read a label or a boolean puts thousands of modules
 * into consumers that only ever needed a string, so those two facts live here
 * and `./config` composes them into its own entries.
 */
export const FOLDER_RESOURCE_LABELS: Record<FolderResourceType, string> = {
  workflow: 'workflow',
  file: 'file',
  knowledge_base: 'knowledge base',
  table: 'table',
}

/**
 * Resource types whose folders participate in the mutation-lock system. Only
 * workflow folders can be locked; the rest have no lock semantics to honour.
 *
 * The single declaration of that fact: `./config` composes it into
 * {@link FolderResourceConfig.supportsLocking} rather than restating it, so the
 * routes that read the trait directly and the orchestration that reads it off
 * the config cannot disagree about which resources lock.
 */
export const FOLDER_RESOURCE_SUPPORTS_LOCKING: Record<FolderResourceType, boolean> = {
  workflow: true,
  file: false,
  knowledge_base: false,
  table: false,
}

/** Human-readable name for `resourceType`, for messages a caller reads. */
export function folderResourceLabel(resourceType: FolderResourceType): string {
  return FOLDER_RESOURCE_LABELS[resourceType]
}

/** Whether `resourceType`'s folders honour the folder mutation lock. */
export function folderResourceSupportsLocking(resourceType: FolderResourceType): boolean {
  return FOLDER_RESOURCE_SUPPORTS_LOCKING[resourceType]
}
