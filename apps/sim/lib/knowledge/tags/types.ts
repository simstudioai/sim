export interface DocumentTagDefinition {
  id: string
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: Date
  updatedAt: Date
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
