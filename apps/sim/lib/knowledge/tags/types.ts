export interface DocumentTagDefinition {
  id: string
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Represents a tag assigned to a document with its slot, display name, type, and value
 */
export interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

export interface CreateTagDefinitionData {
  tagSlot: string
  displayName: string
  fieldType: string
  originalDisplayName?: string
}

export interface BulkTagDefinitionsData {
  definitions: CreateTagDefinitionData[]
}
