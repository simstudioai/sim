/**
 * Shared SVG `<defs>` for the iso goo-mark family: the brand radial gradient
 * (`#2C2C2C` center → `#5F5F5F` edge) and the metaball goo filter. The iso marks
 * pass a lower `gooFusion` (0.8) so the wireframes stay crisp while still fusing
 * softly at the joints.
 */
interface GooDefsProps {
  gradId: string
  gooId: string
  gooFusion?: number
  /** Gradient stops + radial position - default to the locked brand recipe. */
  from?: string
  to?: string
  cx?: number
  cy?: number
  r?: number
}

export function GooDefs({
  gradId,
  gooId,
  gooFusion = 1.5,
  from = '#2C2C2C',
  to = '#5F5F5F',
  cx = 50,
  cy = 50,
  r = 44,
}: GooDefsProps) {
  return (
    <defs>
      <radialGradient id={gradId} gradientUnits='userSpaceOnUse' cx={cx} cy={cy} r={r}>
        <stop stopColor={from} />
        <stop offset='1' stopColor={to} />
      </radialGradient>
      <filter id={gooId} x='-25%' y='-25%' width='150%' height='150%'>
        <feGaussianBlur in='SourceGraphic' stdDeviation={gooFusion} result='b' />
        <feColorMatrix in='b' type='matrix' values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9' />
      </filter>
    </defs>
  )
}
