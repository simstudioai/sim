export interface DocumentTagDefinition {
  id: string
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: Date
  updatedAt: Date
}

interface CreateTagDefinitionData {
  tagSlot: string
  displayName: string
  fieldType: string
  originalDisplayName?: string
}

export interface BulkTagDefinitionsData {
  definitions: CreateTagDefinitionData[]
}
