export const SLAB = {
  width: 5.6,
  depth: 5.6,
  cornerRadius: 1.1,
  thickness: 0.13,
  bevel: 0.045,
  gap: 0.72,
} as const
export const STACK_CAMERA = { x: 10, y: 10, z: 13 } as const

/** Artwork centers on the 360 × 360 plane, with its caption below. */
export const STACK_ENGRAVING = {
  x: 180,
  y: 180,
  scale: 0.25,
  gradientRadius: 240,
  labelY: 270,
  wordmarkScale: 0.2,
} as const

/** Charcoal engravings on silver planes; silver engravings on graphite planes. */
export const STACK_INK = { inner: '#2c2c2c', outer: '#5f5f5f' } as const
export const STACK_DARK_INK = { inner: '#a7a7a7', outer: '#d6d6d6' } as const
