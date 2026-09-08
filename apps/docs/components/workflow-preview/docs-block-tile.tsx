import { BlockTileView, type BlockTileViewProps } from '@sim/workflow-renderer'
import { coreBlockTypes } from '@/components/ui/icon-mapping'
import { normalizeBlockType, resolveIcon } from '@/components/workflow-preview/block-icons'

interface DocsBlockTileProps {
  type: string
  color?: string
  isIntegration?: boolean
  triggerMode?: boolean
  size?: BlockTileViewProps['size']
}

/** Resolves authored diagram metadata for the editor's shared tile view. */
export function DocsBlockTile({
  type,
  color,
  isIntegration,
  triggerMode,
  size = 'lg',
}: DocsBlockTileProps) {
  const blockType = normalizeBlockType(type, triggerMode)
  const useAccent =
    isIntegration === undefined
      ? coreBlockTypes.has(blockType) || blockType === 'loop' || blockType === 'parallel'
      : !isIntegration
  return (
    <BlockTileView
      blockType={blockType}
      icon={resolveIcon(blockType) ?? undefined}
      bgColor={color}
      useAccent={useAccent}
      size={size}
    />
  )
}
