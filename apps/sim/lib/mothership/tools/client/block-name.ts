import { getBlock } from '@/blocks/registry'

/** A block type's display name. Its own module so a host without the block registry can replace it. */
export function resolveBlockName(type: string): string | undefined {
  return getBlock(type)?.name
}
