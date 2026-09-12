import type { Category, Data, Definition } from '#design-diff/types'

export function category(definition: Definition): Category {
  const property = definition.property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
  if (definition.property === 'infrastructure') return 'infrastructure'
  if (definition.kind === 'review') return 'unresolved'
  if (
    (definition.kind === 'asset' && /\.(?:woff2?|ttf|otf|eot)$/i.test(definition.location.file)) ||
    (definition.kind === 'css' &&
      definition.property === 'src' &&
      definition.conditions.some(
        (condition) => typeof condition === 'string' && condition.startsWith('@font-face')
      ))
  )
    return 'typography'
  if (definition.kind === 'asset' || definition.kind === 'content' || definition.kind === 'markup')
    return 'content'
  if (/^(?:src|src-set|alt|title|placeholder|d|points|view-box)$/.test(property)) return 'content'
  if (/^(?:gap|row-gap|column-gap|align.*|justify.*|position)$/.test(property)) return 'layout'
  if (/^margin/.test(property)) return 'dimensions'
  if (property === 'transform') {
    const data = definition.value
    const value =
      typeof data === 'string'
        ? data
        : data && typeof data === 'object' && !Array.isArray(data) && typeof data.value === 'string'
          ? data.value
          : ''
    if (!/^(?:translate[XYZ3d]*\([^)]*\)\s*)+$/.test(value)) return 'shape-effects'
  }
  if (/^--tw-translate-/.test(property)) return 'movement'
  if (
    /^(?:x|y|cx|cy|top|right|bottom|left|inset.*|translate.*|transform|margin.*|gap|rowGap|columnGap|align.*|justify.*|position|trafficLightPosition)$/i.test(
      definition.property
    )
  )
    return 'movement'
  if (/color|background|fill|gradient|surface/.test(property)) return 'colour'
  if (/font|text|line-height|letter|word-spacing/.test(property)) return 'typography'
  if (/width|height|padding|size|aspect/.test(property)) return 'dimensions'
  if (/radius|border|shadow|opacity|filter|blur|scale|clip-path/.test(property))
    return 'shape-effects'
  if (/visibility|display|overflow|hidden|z-index|clip/.test(property)) return 'visibility'
  if (/animation|transition|animate|initial|exit|while/.test(property)) return 'motion'
  if (/flex|grid|wrap|columns|float|clear|contain/.test(property)) return 'layout'
  if (definition.kind === 'class') return 'layout'
  if (definition.kind === 'css' || definition.kind === 'style') return 'layout'
  if (definition.property === 'variant') return 'shape-effects'
  if (definition.kind === 'native' || definition.property === 'orientation') return 'layout'
  return 'unresolved'
}

export const limitations = [
  'Designer policy: wording, documentation content, options/data, media and unchanged shared-component additions are exempt. Notifications require supported authored appearance changes.',
  'Static source analysis does not establish pixel equality or complete runtime behavior.',
  'Unresolved expressions, parser limits, unknown props, rendering configuration and runtime-only effects do not qualify a PR on their own. Their coverage notes are not proof that appearance is unchanged.',
  'Import propagation covers static imports/re-exports, supported aliases and literal asset paths; runtime-generated paths cannot be enumerated.',
  'Tailwind 4.3.3 normalizes core utilities and CSS theme declarations. Proposed JavaScript configuration, plugins and external CSS are not executed.',
  'Coordinates and translation alone are exempt; explicit margins, gaps, alignment, positioning mode, wrapping, dimensions and clipping remain appearance evidence. Runtime overlap and movement consequences are not established.',
  'Findings are grouped by changed source file; direct changes and one representative consumer are retained.',
  'Named imports follow re-exports to their defining module. Ambiguous imports and further transitive module effects retain conservative dependencies.',
  'Usage counts measure resolved static references to changed bindings and local dependents, not confirmed visual changes or rendered instances.',
  'Repeated appearance values are matched across insertions. Structural correspondence is approximate; inactive variants and unused authored styles can still qualify.',
]

/** Derives a class category from changed generated declarations when they agree. */
export function changedCategory(
  before: Definition | undefined,
  after: Definition | undefined
): Category {
  const definition = after ?? before
  if (!definition) return 'unresolved'
  if (definition.kind !== 'class') return category(definition)
  const declarations = (value: Data | undefined) => {
    const result = new Map<string, string[]>()
    const visit = (data: Data) => {
      if (Array.isArray(data)) {
        data.forEach(visit)
        return
      }
      if (!data || typeof data !== 'object') return
      for (const [key, child] of Object.entries(data)) {
        if (key === 'css' && Array.isArray(child) && Array.isArray(data.order)) {
          for (const css of child) {
            if (typeof css !== 'string') continue
            for (const declaration of JSON.parse(css) as [string[], string, string, boolean][]) {
              if (!Array.isArray(declaration[0]) || typeof declaration[1] !== 'string') continue
              const [conditions, property, value, important] = declaration
              const signature = JSON.stringify([
                conditions.map((condition) => (condition.startsWith('.') ? '.utility' : condition)),
                value,
                important,
              ])
              result.set(property, [...(result.get(property) ?? []), signature])
            }
          }
        } else visit(child)
      }
    }
    if (value !== undefined) visit(value)
    return result
  }
  let a: Map<string, string[]>
  let b: Map<string, string[]>
  try {
    a = declarations(before?.value)
    b = declarations(after?.value)
  } catch {
    return 'unresolved'
  }
  const categories = new Set<Category>()
  for (const property of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(property)) !== JSON.stringify(b.get(property)))
      categories.add(category({ ...definition, kind: 'style', property }))
  }
  if (categories.size === 1) return [...categories][0]
  return category(definition)
}
