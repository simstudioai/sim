import { canonicalJson } from '#design-diff/ast'
import type { Data, Definition } from '#design-diff/types'

export const appearanceAttributes =
  /^(?:className|.*ClassName|class|style|width|height|minWidth|minHeight|maxWidth|maxHeight|size|rows|cols|color|backgroundColor|opacity|variant|orientation|animate|initial|exit|transition|whileHover|whileTap)$/
export const mediaElement =
  /^(?:svg|img|image|picture|video|audio|source|canvas|Image|Video|Icon|.*Icon)$/

function object(value: Data | undefined): value is Record<string, Data> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Ignore asset identity and generated copy while preserving gradients and other CSS effects. */
function cssAppearance(value: string): string {
  return value.replace(/url\([^)]*\)/g, 'url(asset)')
}

/** Retain supported style values, never arbitrary captured inputs inside opaque expressions. */
function literal(value: Data, depth = 0, args?: Data[]): Data | undefined {
  if (depth > 32) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const values = value.map((item) => literal(item, depth + 1))
    return values.every((item) => item !== undefined) ? (values as Data[]) : undefined
  }
  if ('$await' in value) return literal(value.$await, depth + 1, args)
  if (Array.isArray(value.$parameter) && args) {
    let selected: Data = args
    for (const key of value.$parameter) {
      if (typeof key !== 'number' && typeof key !== 'string') return undefined
      if (Array.isArray(selected) && typeof key === 'number') selected = selected[key]
      else if (object(selected)) selected = selected[String(key)]
      else return undefined
      if (selected === undefined) return undefined
    }
    return literal(selected, depth + 1)
  }
  if ('$default' in value) {
    const input = literal(value.input, depth + 1, args)
    const fallback = literal(value.$default, depth + 1, args)
    return fallback === undefined ? undefined : { input: input ?? null, fallback }
  }
  if ('$selectedCall' in value && object(value.$selectedCall))
    return literal(
      value.$selectedCall,
      depth + 1,
      Array.isArray(value.arguments) ? value.arguments : args
    )
  if (object(value.$call) && Array.isArray(value.$call.$function))
    return literal(value.$call, depth + 1, Array.isArray(value.arguments) ? value.arguments : args)
  if ('$reactState' in value && Array.isArray(value.updates)) {
    const initial = literal(value.$reactState, depth + 1)
    const updates = value.updates.flatMap((entry) => {
      if (!object(entry)) return []
      const result = literal(entry.value, depth + 1)
      return result === undefined ? [] : [result]
    })
    return initial !== undefined || updates.length
      ? { initial: initial ?? null, updates }
      : undefined
  }
  if (Array.isArray(value.$function)) {
    const values = value.$function.map((item) =>
      object(item) && 'value' in item ? literal(item.value, depth + 1, args) : undefined
    )
    return values.length && values.every((item) => item !== undefined)
      ? { returns: values as Data[] }
      : undefined
  }
  if ('$condition' in value) {
    const a = literal(value.then, depth + 1)
    const b = literal(value.else, depth + 1)
    return a !== undefined && b !== undefined ? { branches: [a, b] } : undefined
  }
  if (Object.keys(value).some((key) => key.startsWith('$'))) return undefined
  const result: Record<string, Data> = {}
  for (const [key, item] of Object.entries(value)) {
    const supported = literal(item, depth + 1)
    if (supported === undefined) return undefined
    result[key] = supported
  }
  return result
}

/** Generated CSS is evidence; helper fingerprints, runtime predicates and diagnostics are not. */
function classes(value: Data): Data | undefined {
  if (value === null || value === false) return null
  if (Array.isArray(value)) {
    const items = value.map(classes).filter((item): item is Data => item !== undefined)
    return items.length ? items : undefined
  }
  if (!object(value)) return undefined
  if (Array.isArray(value.css) && Array.isArray(value.order)) {
    const css = value.css
      .filter((item): item is string => typeof item === 'string')
      .map((item) => {
        const declarations = JSON.parse(item) as [string[], string, string, boolean][]
        return JSON.stringify(
          declarations
            .filter(([, property]) => property !== 'content')
            .map(([conditions, property, data, important]) => [
              conditions.map((condition) => (condition.startsWith('.') ? '.utility' : condition)),
              property,
              cssAppearance(data),
              important,
            ])
        )
      })
    if (!css.length && value.order.length) return undefined
    const variables = Array.isArray(value.variables)
      ? value.variables.map((item) => {
          if (!object(item) || !object(item.value)) return item
          const { order: _order, ...data } = item.value
          return { ...item, value: data }
        })
      : []
    return { css, variables }
  }
  if ('$classes' in value) return classes(value.$classes)
  if (Array.isArray(value.$cva)) {
    const [base, options] = value.$cva
    const variants: Record<string, Data> = {}
    if (object(options) && object(options.variants))
      for (const [name, choices] of Object.entries(options.variants)) {
        const supported: Record<string, Data> = {}
        if (object(choices))
          for (const [choice, definition] of Object.entries(choices)) {
            const result = classes(definition)
            if (result !== undefined) supported[choice] = result
          }
        variants[name] = supported
      }
    return {
      base: classes(base) ?? null,
      variants,
      defaults: object(options) ? (literal(options.defaultVariants ?? null) ?? null) : null,
      compoundVariants: object(options)
        ? (literal(options.compoundVariants ?? null) ?? null)
        : null,
    }
  }
  if ('$variant' in value) return classes(value.$variant)
  if ('$condition' in value) return classes([value.then ?? null, value.else ?? null])
  if (value.$operator === '&&') return classes(value.right)
  return undefined
}

/** The notification policy requires concrete authored appearance, independent of render guards. */
export function appearanceValue(definition: Definition): Data | undefined {
  if (definition.appearance?.media) return undefined
  if (definition.kind === 'asset' && /\.(?:woff2?|ttf|otf|eot)$/i.test(definition.location.file))
    return definition.value
  if (definition.kind === 'class') {
    if (!object(definition.value) || !Array.isArray(definition.value.normalized)) return undefined
    const values = definition.value.normalized.flatMap((entry) => {
      if (!object(entry)) return []
      const value = classes(entry.value)
      return value === undefined ? [] : [value]
    })
    return values.length ? values : undefined
  }
  if (definition.kind === 'css') {
    if (definition.property.startsWith('@')) return undefined
    if (definition.property === 'content') return undefined
    if (typeof definition.value === 'string') return definition.value
    if (!object(definition.value)) return undefined
    const { order: _order, ...value } = definition.value
    if (typeof value.value === 'string' && /url\(/.test(value.value))
      value.value =
        definition.property === 'src' &&
        definition.conditions.some(
          (condition) => typeof condition === 'string' && condition.startsWith('@font-face')
        )
          ? value.value
          : cssAppearance(value.value)
    return { ...value, context: definition.conditions }
  }
  if (
    !['style', 'native'].includes(definition.kind) &&
    !(definition.kind === 'attribute' && appearanceAttributes.test(definition.property))
  )
    return undefined
  if (/^(?:icon|setIcon|setImage|trafficLightPosition|setPosition)$/.test(definition.property))
    return undefined
  if (definition.property === 'content') return undefined
  if (object(definition.value) && Array.isArray(definition.value.normalized)) {
    const source = literal(definition.value.source)
    if (source === undefined) return undefined
    return { source, normalized: canonicalJson(definition.value.normalized) }
  }
  const value = literal(definition.value)
  return typeof value === 'string' ? cssAppearance(value) : value
}

export function sameAppearance(a: Definition, b: Definition): boolean {
  return JSON.stringify(appearanceValue(a)) === JSON.stringify(appearanceValue(b))
}
