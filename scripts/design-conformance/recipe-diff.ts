import type { extractCentralRecipes } from '#design-conformance/central-recipes'
import { registry } from '#design-conformance/contracts'
import { category, type Finding } from '#design-conformance/model'

type Recipes = ReturnType<typeof extractCentralRecipes>

/** Compare registered exports individually; opaque replacement output proves no removal. */
export function recipeDiff(file: string, before?: Recipes, after?: Recipes): Finding[] {
  const findings: Finding[] = []
  const contract = registry.centralRecipes?.[file]
  if (!contract) return findings
  const definitions = (recipes?: Recipes) =>
    new Map(recipes?.definitions.map((a) => [a.context, a]) ?? [])
  const b = definitions(before)
  const a = definitions(after)
  for (const [name, authority] of Object.entries(contract.exports)) {
    const context = `central-recipe:${name}`
    const previous = b.get(context)
    const next = a.get(context)
    if (after?.unresolvedExports.includes(name)) continue
    if ((!previous && !next) || previous?.value === next?.value) continue
    const current = next ?? previous
    if (!current) continue
    const oldInput = before?.inputs[name]
    const input = after?.inputs[name]
    findings.push({
      kind: 'system-change',
      contract: 'central-definition',
      rule: 'central-definition',
      category: category(authority.property) ?? 'styling-infrastructure',
      property: authority.property,
      file,
      line: current.line,
      column: current.column,
      context,
      value: input ?? '(registered export removed)',
      ...(oldInput ? { before: oldInput } : {}),
      reason: `Registered central styling recipe ${name} ${!next ? 'removed' : previous || before?.unresolvedExports.includes(name) ? 'changed' : 'added'}${before?.unresolvedExports.includes(name) ? '; previous output was unresolved' : ''}`,
      provenance: {
        source: authority.source,
        input: input ?? oldInput ?? name,
        permitted: registry.rules['central-definition'].permission,
      },
    })
  }
  return findings
}
