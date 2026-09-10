import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'

export const STACK_SCROLL_END = STACK_LAYERS.length
export const STACK_LAYER_REST = 0.82
export const STACK_PLAYBACK_END = STACK_SCROLL_END - 1 + STACK_LAYER_REST

/** Every layer arrives, traces its illustration, then rests before the next arrival. */
export function getStackLayerProgress(progress: number, index: number) {
  const phase = progress - index
  return {
    entrance: index === 0 ? 1 : Math.min(1, Math.max(0, (phase + 0.1) / 0.3)),
    drawing: Math.min(1, Math.max(0, index === 0 ? (phase - 0.6) / 0.2 : (phase - 0.36) / 0.4)),
  }
}

/** Keep the camera still while engraving; move it only as another slab arrives. */
export function getStackAssemblyProgress(progress: number) {
  let assembled = 0
  for (let index = 1; index < STACK_LAYERS.length; index++) {
    assembled += getStackLayerProgress(progress, index).entrance
  }
  return assembled
}

/** The Sim cover closes the stack into a compact assembly, reversible with scroll. */
export function getStackSpacing(progress: number) {
  const closing = getStackLayerProgress(progress, STACK_LAYERS.length - 1).entrance
  const eased = closing * closing * (3 - 2 * closing)
  return 1 - eased * 0.6
}

/** Fade only received shadows as the next plane descends, leaving the artwork opaque. */
export function getStackShadowStrength(progress: number, index: number) {
  if (index >= STACK_LAYERS.length - 1) return 0
  const { entrance } = getStackLayerProgress(progress, index + 1)
  return entrance * entrance * (3 - 2 * entrance)
}

/** Trace the foundation, fade descending slabs in, then reveal their engravings. */
export function getStackSurfaceProgress(progress: number, index: number) {
  const phase = progress - index
  const fill =
    index === 0
      ? Math.min(1, Math.max(0, (phase - 0.27) / 0.16))
      : Math.min(1, getStackLayerProgress(progress, index).entrance / 0.25)
  return {
    outline: index === 0 ? Math.min(1, Math.max(0, (phase - 0.03) / 0.23)) : 0,
    fill: fill * fill * (3 - 2 * fill),
    label: Math.min(1, Math.max(0, index === 0 ? (phase - 0.44) / 0.15 : (phase - 0.2) / 0.14)),
  }
}
