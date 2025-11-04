export interface SubBlockState {
  workflowValues: Record<string, Record<string, Record<string, any>>> // Store values per workflow ID
  loadingWebhooks: Set<string> // Track which blockIds are currently loading webhooks
  checkedWebhooks: Set<string> // Track which blockIds have been checked for webhooks
  loadingSchedules: Set<string> // Track which blockIds are currently loading schedules
  checkedSchedules: Set<string> // Track which blockIds have been checked for schedules
}

export interface SubBlockStore extends SubBlockState {
  setValue: (blockId: string, subBlockId: string, value: any) => void
  getValue: (blockId: string, subBlockId: string) => any
  clear: () => void
  initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => void
}
