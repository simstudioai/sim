import {
  getAllBlocks,
  getAllBlockTypes,
  getBlock,
  getBlocksByCategory,
  isValidBlockType,
  registry,
} from '@/blocks/registry'

export { registry, getBlock, getBlocksByCategory, getAllBlockTypes, isValidBlockType, getAllBlocks }

export type { BlockConfig } from '@/blocks/types'
