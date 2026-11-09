'use client'

/**
 * Block information for context menu actions
 */
export interface BlockInfo {
  id: string
  type: string
  enabled: boolean
  parentId?: string
  parentType?: string
  locked?: boolean
  isParentLocked?: boolean
  isParentDisabled?: boolean
}
