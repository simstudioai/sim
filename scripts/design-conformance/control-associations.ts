import type { InventoryFinding } from '#control-analysis/model'

interface Location {
  line: number
  column: number
  endLine: number
  endColumn: number
}
interface Use {
  id: string
  file: string
  line: number
  column: number
  endLine: number
  endColumn?: number
  owner: string
  tag: string
  slots?: (Location & { name: string })[]
}
const contains = (r: Location, line: number, column: number) =>
  (line > r.line || (line === r.line && column >= r.column)) &&
  (line < r.endLine || (line === r.endLine && column < r.endColumn))
const width = (r: Location) => (r.endLine - r.line) * 1000000 + r.endColumn - r.column

/** Choose the innermost input slot across ALL elements, including non-controls. */
export function associateFindings(
  uses: Use[],
  findings: InventoryFinding[],
  targets: (id: string, slot: string) => string[]
) {
  const result = new Map<string, { direct: string[]; potential: string[] }>()
  const files = new Map<string, Use[]>()
  for (const use of uses) {
    const xs = files.get(use.file) ?? []
    xs.push(use)
    files.set(use.file, xs)
    result.set(use.id, { direct: [], potential: [] })
  }
  for (const f of findings) {
    const elements = files.get(f.file) ?? []
    const slots = elements
      .flatMap((use) =>
        (use.slots ?? [])
          .filter((slot) => contains(slot, f.line, f.column))
          .map((slot) => ({ use, slot }))
      )
      .sort((a, b) => width(a.slot) - width(b.slot))
    const parts = f.context.split(' / ')
    const target = parts[1]
    const input = parts[2]?.split(/[ ./]/)[0]
    if (slots.length) {
      const best = slots.filter((s) => width(s.slot) === width(slots[0].slot))
      for (const { use, slot } of best) {
        const exact =
          best.length === 1 &&
          !!target &&
          targets(use.id, slot.name).includes(target) &&
          (slot.name === input || slot.name === 'spread')
        result.get(use.id)?.[exact ? 'direct' : 'potential'].push(f.id)
      }
    } else {
      const exact = elements.filter(
        (use) =>
          use.owner === parts[0] &&
          use.line === f.line &&
          use.column === f.column &&
          !!target &&
          !!input &&
          (use.slots ?? []).some(
            (slot) => slot.name === input && targets(use.id, slot.name).includes(target)
          )
      )
      if (exact.length === 1) result.get(exact[0].id)?.direct.push(f.id)
      else
        for (const use of elements.filter(
          (u) => u.owner === parts[0] && f.line >= u.line && f.line <= u.endLine
        ))
          result.get(use.id)?.potential.push(f.id)
    }
  }
  for (const r of result.values()) {
    r.direct.sort()
    r.potential.sort()
  }
  return result
}
