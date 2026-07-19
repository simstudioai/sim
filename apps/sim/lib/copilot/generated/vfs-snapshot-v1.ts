// AUTO-GENERATED FILE. DO NOT EDIT.
//

/**
 * Structured workspace inventory snapshot Sim sends to Go; Go diffs successive snapshots into baseline+delta messages.
 */
export interface VfsSnapshotV1 {
  customTools?: VfsSnapshotV1NamedResource[]
  envVars?: string[]
  files?: VfsSnapshotV1File[]
  integrations?: VfsSnapshotV1Integration[]
  interfaces?: VfsSnapshotV1InterfaceDef[]
  jobs?: VfsSnapshotV1Job[]
  knowledgeBases?: VfsSnapshotV1KnowledgeBase[]
  mcpServers?: VfsSnapshotV1McpServer[]
  members?: VfsSnapshotV1Member[]
  skills?: VfsSnapshotV1Skill[]
  tables?: VfsSnapshotV1Table[]
  workflows?: VfsSnapshotV1Workflow[]
  workspace?: VfsSnapshotV1Workspace
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1NamedResource".
 */
export interface VfsSnapshotV1NamedResource {
  id: string
  name: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1File".
 */
export interface VfsSnapshotV1File {
  folderPath?: string
  id: string
  name: string
  path: string
  size?: number
  type?: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Integration".
 */
export interface VfsSnapshotV1Integration {
  displayName?: string
  id: string
  providerId: string
  role?: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1InterfaceDef".
 */
export interface VfsSnapshotV1InterfaceDef {
  description?: string
  id: string
  name: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Job".
 */
export interface VfsSnapshotV1Job {
  cronExpression?: string
  id: string
  lifecycle?: string
  prompt?: string
  sourceTaskName?: string
  status?: string
  title?: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1KnowledgeBase".
 */
export interface VfsSnapshotV1KnowledgeBase {
  connectorTypes?: string[]
  description?: string
  id: string
  name: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1McpServer".
 */
export interface VfsSnapshotV1McpServer {
  enabled?: boolean
  id: string
  name: string
  url?: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Member".
 */
export interface VfsSnapshotV1Member {
  email: string
  name?: string
  permissionType?: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Skill".
 */
export interface VfsSnapshotV1Skill {
  description?: string
  id: string
  name: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Table".
 */
export interface VfsSnapshotV1Table {
  description?: string
  id: string
  name: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Workflow".
 */
export interface VfsSnapshotV1Workflow {
  folderPath?: string
  id: string
  isDeployed?: boolean
  name: string
  path: string
}
/**
 * This interface was referenced by `VfsSnapshotV1`'s JSON-Schema
 * via the `definition` "VfsSnapshotV1Workspace".
 */
export interface VfsSnapshotV1Workspace {
  id: string
  name: string
  ownerId?: string
}
