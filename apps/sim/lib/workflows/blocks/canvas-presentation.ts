import { resolveDropdownLabel } from '@/lib/workflows/subblocks/display'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

type CanvasPresentationConfig = Pick<BlockConfig, 'name' | 'subBlocks' | 'canvasPresentation'>

export interface CanvasBlockPresentation {
  title: string
  typeLabel: string
  usesDefaultTitle: boolean
  operationSubBlockId?: string
  operationRowTitle?: string
}

function isGeneratedBlockName(name: string, config: CanvasPresentationConfig): boolean {
  const candidates = [config.name, config.canvasPresentation?.defaultName].filter(
    (candidate): candidate is string => Boolean(candidate)
  )
  const normalizedName = name.trim().toLocaleLowerCase()

  return candidates.some((candidate) => {
    const normalizedCandidate = candidate.trim().toLocaleLowerCase()
    if (normalizedName === normalizedCandidate) return true
    if (!normalizedName.startsWith(`${normalizedCandidate} `)) return false

    const suffix = normalizedName.slice(normalizedCandidate.length + 1)
    return /^\d+$/.test(suffix)
  })
}

function getOperationTitle(
  subBlocks: SubBlockConfig[],
  operationSubBlockId: string | undefined,
  rawValues: Record<string, unknown>
): string | null {
  if (!operationSubBlockId) return null
  const operationSubBlock = subBlocks.find((subBlock) => subBlock.id === operationSubBlockId)
  return resolveDropdownLabel(operationSubBlock, rawValues[operationSubBlockId])
}

/** Resolves semantic canvas copy without changing the block's persisted internal name. */
export function resolveCanvasBlockPresentation(
  config: CanvasPresentationConfig,
  storedName: string,
  rawValues: Record<string, unknown>
): CanvasBlockPresentation {
  const presentation = config.canvasPresentation
  if (!presentation) {
    return {
      title: storedName,
      typeLabel: config.name,
      usesDefaultTitle: false,
    }
  }

  const usesDefaultTitle = isGeneratedBlockName(storedName, config)
  const operationTitle = usesDefaultTitle
    ? getOperationTitle(config.subBlocks, presentation.operationSubBlockId, rawValues)
    : null

  return {
    title: usesDefaultTitle ? (operationTitle ?? presentation.defaultTitle) : storedName,
    typeLabel: presentation.typeLabel ?? config.name,
    usesDefaultTitle,
    operationSubBlockId: presentation.operationSubBlockId,
    operationRowTitle: presentation.operationRowTitle,
  }
}
