/**
 * Block tag group for organizing tags by block
 */
export interface BlockTagGroup {
  blockName: string
  blockId: string
  blockType: string
  tags: string[]
  distance: number
}

/**
 * Nested tag structure for hierarchical display
 */
export interface NestedTag {
  key: string
  display: string
  fullTag?: string
  parentTag?: string // Tag for the parent object when it has children
  children?: Array<{ key: string; display: string; fullTag: string }>
}

/**
 * Block tag group with nested tag structure
 */
export interface NestedBlockTagGroup extends BlockTagGroup {
  nestedTags: NestedTag[]
}
