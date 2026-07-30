/**
 * Shared SVG `<defs>` for the circle goo-mark family: the brand radial gradient
 * (`#2C2C2C` center → `#5F5F5F` edge) and the metaball goo filter (blur → alpha
 * threshold). Values are locked to the brand recipe.
 */
interface GooDefsProps {
  gradId: string
  gooId: string
  gooFusion?: number
}

export function GooDefs({ gradId, gooId, gooFusion = 1.5 }: GooDefsProps) {
  return (
    <defs>
      <radialGradient id={gradId} gradientUnits='userSpaceOnUse' cx='50' cy='50' r='44'>
        <stop stopColor='#2C2C2C' />
        <stop offset='1' stopColor='#5F5F5F' />
      </radialGradient>
      <filter id={gooId} x='-25%' y='-25%' width='150%' height='150%'>
        <feGaussianBlur in='SourceGraphic' stdDeviation={gooFusion} result='b' />
        <feColorMatrix in='b' type='matrix' values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9' />
      </filter>
    </defs>
  )
}
