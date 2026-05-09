export interface ComputePanelScaleInput {
  panelWidth: number
  elementWidth?: number | null
  elementHeight?: number | null
  fallbackWidth: number
  fallbackHeight: number
}

export interface ComputePanelScaleResult {
  scale: number
  scaledHeight: number
}

export function computePanelScale(input: ComputePanelScaleInput): ComputePanelScaleResult | null {
  const panelWidth = Number.isFinite(input.panelWidth) ? input.panelWidth : 0
  if (panelWidth <= 0) return null

  const baseWidth =
    Number.isFinite(input.elementWidth) && input.elementWidth! > 0
      ? input.elementWidth!
      : input.fallbackWidth
  const baseHeight =
    Number.isFinite(input.elementHeight) && input.elementHeight! > 0
      ? input.elementHeight!
      : input.fallbackHeight
  if (
    !Number.isFinite(baseWidth) ||
    !Number.isFinite(baseHeight) ||
    baseWidth <= 0 ||
    baseHeight <= 0
  ) {
    return null
  }

  const scale = panelWidth / baseWidth
  return {
    scale,
    scaledHeight: baseHeight * scale,
  }
}
