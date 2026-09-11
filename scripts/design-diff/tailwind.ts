import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import postcss from 'postcss'
import { extendTailwindMerge } from 'tailwind-merge'
import { __unstable__loadDesignSystem } from 'tailwindcss'
import { cssValue, extractCss } from '#design-diff/extract/css'
import { object } from '#design-diff/resolve'
import type { SourceTree } from '#design-diff/source'
import type { Data, Definition } from '#design-diff/types'

const require = createRequire(import.meta.url)
const defaultTheme = readFileSync(
  path.join(path.dirname(require.resolve('tailwindcss/package.json')), 'theme.css'),
  'utf8'
)
type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>

/** Only CSS data reaches the pinned compiler. No application module loader is provided. */
export class TailwindNormalizer {
  private readonly systems = new Map<
    string,
    Promise<{
      system: DesignSystem
      variables: Definition[]
      files: string[]
      limitations: string[]
    }>
  >()
  constructor(readonly tree: SourceTree) {}

  private theme(file: string) {
    const cached = this.systems.get(file)
    if (cached) return cached
    const promise = (async () => {
      const visited = new Set<string>()
      const variables: Definition[] = extractCss(defaultTheme, 'trusted:tailwind/theme.css')
      const limitations: string[] = []
      const chunks = [defaultTheme]
      const visit = (current: string) => {
        if (visited.has(current)) return
        visited.add(current)
        const text = this.tree.texts.get(current)
        if (text === undefined) {
          limitations.push('Theme source unavailable')
          return
        }
        const root = postcss.parse(text)
        root.each((node) => {
          if (node.type !== 'atrule') return
          if (['theme', 'custom-variant', 'utility'].includes(node.name))
            chunks.push(`${node.toString()}${node.nodes ? '' : ';'}`)
          if (['plugin', 'config'].includes(node.name))
            limitations.push('Application JavaScript plugins/configuration are not executed')
          if (node.name === 'import') {
            const specifier = node.params.match(/^["']([^"']+)["']/)?.[1]
            if (!specifier || specifier === 'tailwindcss') return
            const target = this.tree.resolve(current, specifier)
            if (target) visit(target)
            else limitations.push(`External CSS import is not expanded: ${specifier}`)
          }
        })
        variables.push(
          ...extractCss(text, current).filter((definition) => definition.property.startsWith('--'))
        )
      }
      if (file) visit(file)
      const system = await __unstable__loadDesignSystem(chunks.join('\n'), {
        loadModule: async () => {
          throw new Error('Application modules are never loaded')
        },
        loadStylesheet: async () => {
          throw new Error('Nested stylesheet imports are not executed')
        },
      })
      return {
        system,
        variables,
        files: [...visited].sort(),
        limitations: [...new Set(limitations)].sort(),
      }
    })()
    this.systems.set(file, promise)
    return promise
  }

  async normalize(definition: Definition): Promise<Definition> {
    if (definition.kind !== 'class' && !JSON.stringify(definition.value).includes('var(--'))
      return definition
    const classes = (value: string) => value.split(/\s+/).filter(Boolean).join(' ')
    if (definition.kind === 'class') {
      if (typeof definition.value === 'string')
        definition = { ...definition, value: classes(definition.value) }
      else if (object(definition.value) && typeof definition.value.$classes === 'string')
        definition = {
          ...definition,
          value: { ...definition.value, $classes: classes(definition.value.$classes) },
        }
    }
    const themes = this.tree.config.themes.filter((theme) =>
      theme.roots.some((root) => definition.location.file.startsWith(root))
    )
    const payloads: Data[] = []
    const unresolved = [...definition.unresolved]
    const dependencies = new Set(definition.dependencies)
    for (const theme of themes.length ? themes : [{ path: '', roots: [] }]) {
      try {
        const {
          system,
          variables,
          files,
          limitations: themeLimitations,
        } = await this.theme(theme.path)
        if (themeLimitations.includes('Theme source unavailable'))
          unresolved.push('Theme source unavailable')
        for (const file of files) dependencies.add(file)
        const normalize = (data: Data): Data => {
          if (typeof data === 'string') {
            const order = data.split(/\s+/).filter(Boolean)
            const css =
              definition.kind === 'class'
                ? system.candidatesToCss(order)
                : [JSON.stringify(definition.value)]
            const referenced = new Set<string>()
            const collect = (value: string, depth = 0, active = new Set<string>()) => {
              if (depth > 16) {
                unresolved.push('CSS variable resolution depth exceeded')
                return
              }
              for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
                if (active.has(match[1])) {
                  unresolved.push('CSS variable cycle')
                  continue
                }
                if (referenced.has(match[1])) continue
                referenced.add(match[1])
                for (const variable of variables.filter((v) => v.property === match[1]))
                  collect(JSON.stringify(variable.value), depth + 1, new Set([...active, match[1]]))
              }
            }
            css.forEach((value, i) => {
              if (value === null)
                unresolved.push(`Unsupported utility or custom class: ${order[i]}`)
              else collect(value)
            })
            return {
              order,
              css: css.map((value) =>
                value === null ? null : definition.kind === 'class' ? cssValue(value) : value
              ),
              variables: variables
                .filter((variable) => referenced.has(variable.property))
                .map((variable) => ({
                  property: variable.property,
                  value: variable.value,
                  conditions: variable.conditions,
                })),
            }
          }
          if (object(data) && '$classes' in data) {
            const merge = extendTailwindMerge({
              extend: { classGroups: { 'font-size': [{ text: this.tree.config.mergeFontSizes }] } },
            })
            const effective =
              typeof data.$classes === 'string' &&
              (data.composition === 'cn' || data.composition === 'twMerge')
                ? merge(data.$classes)
                : data.$classes
            return { ...data, $classes: normalize(effective), inputOrder: data.$classes }
          }
          if (Array.isArray(data)) return data.map(normalize)
          if (object(data) && '$condition' in data)
            return { $condition: 'runtime', then: normalize(data.then), else: normalize(data.else) }
          if (object(data) && data.$operator === '&&')
            return { $operator: '&&', right: normalize(data.right) }
          if (object(data) && Array.isArray(data.$cva)) {
            const [base, options] = data.$cva
            const variants = object(options) && object(options.variants) ? options.variants : {}
            const normalized: Record<string, Data> = {}
            for (const [name, choices] of Object.entries(variants)) {
              const values: Record<string, Data> = {}
              if (object(choices))
                for (const [choice, classes] of Object.entries(choices))
                  values[choice] = normalize(classes)
              normalized[name] = values
            }
            return {
              ...data,
              $cva: [
                normalize(base),
                { ...(object(options) ? options : {}), variants: normalized },
              ],
            }
          }
          if (object(data) && '$variant' in data)
            return { ...data, $variant: normalize(data.$variant) }
          if (data !== null && data !== false) unresolved.push('Unsupported class composition')
          return data
        }
        payloads.push({
          theme: theme.path,
          limitations: themeLimitations,
          value: normalize(
            definition.kind === 'class' ? definition.value : JSON.stringify(definition.value)
          ),
        })
      } catch {
        unresolved.push('Theme or Tailwind compilation could not be resolved')
      }
    }
    return {
      ...definition,
      value: { source: definition.value, normalized: payloads },
      dependencies: [...dependencies].sort(),
      unresolved: [...new Set(unresolved)].sort(),
    }
  }
}
