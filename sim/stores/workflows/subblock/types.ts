export interface SubBlockState {
  workflowValues: Record<string, Record<string, Record<string, any>>> // Store values per workflow ID
}

export interface SubBlockStore extends SubBlockState {
  setValue: (blockId: string, subBlockId: string, value: any) => void
  getValue: (blockId: string, subBlockId: string) => any
  clear: () => void
  initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => void
  // Add debounced sync function
  syncWithDB: () => void
}
