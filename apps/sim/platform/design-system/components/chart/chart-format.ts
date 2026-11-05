export const chartNumber = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function chartTick(value: number) {
  return compact.format(value).replace(/K$/, 'k')
}
