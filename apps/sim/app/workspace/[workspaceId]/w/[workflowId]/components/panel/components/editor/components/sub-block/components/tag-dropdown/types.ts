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
 * Child tag within a nested structure
 */
export interface NestedTagChild {
  key: string
  display: string
  fullTag: string
}

/**
 * Nested tag structure for hierarchical display.
 * Supports recursive nesting for deeply nested object structures.
 */
export interface NestedTag {
  key: string
  display: string
  fullTag?: string
  parentTag?: string
  /** Leaf children (no further nesting) */
  children?: NestedTagChild[]
  /** Recursively nested folders */
  nestedChildren?: NestedTag[]
}

/**
 * Block tag group with nested tag structure
 */
export interface NestedBlockTagGroup extends BlockTagGroup {
  nestedTags: NestedTag[]
}
