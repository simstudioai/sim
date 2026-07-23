export function ssoDomainsOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase()
  const normalizedRight = right.toLowerCase()
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`.${normalizedRight}`) ||
    normalizedRight.endsWith(`.${normalizedLeft}`)
  )
}
