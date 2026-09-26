import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'
import type {
  ControlHooks,
  ControlSource,
  Diagnostic,
  InventoryFinding,
} from '#control-analysis/model'
import { compare, regular } from '#control-analysis/model'
import { productScope } from '#control-analysis/scope'
import { type Expr, expression, type StaticInputs, unknown } from '#control-analysis/static-inputs'
import { centralFile } from '#design-conformance/contracts'
import { canonical, type Finding, hash, TOKEN_FILE } from '#design-conformance/model'
import { borderDeclarations, rawColours, utility, variablesIn } from '#design-conformance/normalize'

interface Site {
  file: string
  line: number
  column: number
  context: string
}
interface Assignment extends Site {
  name: string
  values: string[]
  unresolved: boolean
  input: string
  direct?: boolean
}
interface Pending extends Site {
  kind: 'object' | 'class' | 'css' | 'property' | 'props' | 'registration'
  value: Expr
  name?: Expr
  input: string
}
interface Check {
  status: 'verified' | 'invalid' | 'unresolved'
  reason: string
  references: string[]
}
interface ColourUse extends Site {
  property: string
  value: string
  variables: string[]
}
export interface VerifiedColourUsage extends ColourUse {
  references: string[]
}
export interface ColourAssignmentReport {
  version: '1.0.0'
  findings: InventoryFinding[]
  unchecked: Diagnostic[]
  assignments: (Assignment & Check)[]
  variables: (Check & { name: string; global: boolean; writers: number; complete: boolean })[]
  uses: ColourUse[]
  verifiedUsages: VerifiedColourUsage[]
  coverage: { checked: number; verified: number; invalid: number; unresolved: number }
}
const colourProperty =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|bottom|left|right|inline|block)(?:-start|-end)?)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|box-shadow|text-shadow)$/
const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
/** A missing layout variable is not evidence of a colour. Actual colour sinks still take precedence. */
const dimensional = (value: string): boolean => {
  const nodes = valueParser(value).nodes.filter(
    (node) => node.type !== 'space' && node.type !== 'comment'
  )
  if (nodes.length !== 1) return false
  const node = nodes[0]
  if (node.type === 'word')
    return /^[+-]?(?:\d*\.)?\d+(?:px|rem|em|ch|ex|lh|rlh|vw|vh|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw|%)$/.test(
      node.value
    )
  if (node.type !== 'function' || node.unclosed) return false
  if (node.value === 'var') {
    const comma = node.nodes.findIndex((part) => part.type === 'div' && part.value === ',')
    return comma >= 0 && dimensional(valueParser.stringify(node.nodes.slice(comma + 1)))
  }
  return ['calc', 'min', 'max', 'clamp'].includes(node.value)
}
const property = (node: t.Node): string | undefined =>
  t.isIdentifier(node) || t.isJSXIdentifier(node)
    ? node.name
    : t.isStringLiteral(node)
      ? node.value
      : undefined
const clean = (node: t.Node): t.Node =>
  t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node)
    ? clean(node.expression)
    : node
const member = (node: t.Node, name: string) =>
  t.isMemberExpression(node) &&
  property(node.property) === name &&
  (!node.computed || t.isStringLiteral(node.property))
const owner = (path: NodePath): string => {
  let current: NodePath | null = path
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id) return current.node.id.name
    if (current.isVariableDeclarator() && t.isIdentifier(current.node.id))
      return current.node.id.name
    current = current.parentPath
  }
  return '<module>'
}

/** Audit assignments independently of uses: an unchanged CSS sink cannot hide a new bad writer. */
export class ColourAssignments {
  private readonly assignments: Assignment[] = []
  private readonly pending: Pending[] = []
  private readonly globals = new Map<string, string[]>()
  private readonly colours = new Set<string>()
  private readonly notes: Diagnostic[] = []
  private readonly uses: ColourUse[] = []

  constructor(source: ControlSource) {
    for (const entry of [...source.entries].sort((a, b) => compare(a.path, b.path))) {
      if (!entry.path.endsWith('.css') || productScope(entry.path) !== 'check') continue
      if (!regular(entry) || entry.bytes > 2 * 1024 * 1024) {
        this.notes.push({
          file: entry.path,
          line: 1,
          context: 'colour assignments',
          reason: 'CSS assignment source is nonregular or exceeds the parsing limit',
        })
        continue
      }
      this.css(
        source.read(entry),
        { file: entry.path, line: 1, column: 1, context: 'CSS' },
        entry.path === TOKEN_FILE
      )
    }
  }

  private css(text: string, site: Site, global = false) {
    try {
      postcss.parse(text).walkDecls((decl) => {
        const at = {
          ...site,
          line: site.line + (decl.source?.start?.line ?? 1) - 1,
          column: decl.source?.start?.column ?? site.column,
          context: `${site.context} / ${decl.parent?.type === 'rule' ? decl.parent.selector : decl.parent?.type === 'atrule' ? `@${decl.parent.name} ${decl.parent.params}` : '<root>'}`,
        }
        const registered =
          decl.prop === 'initial-value' &&
          decl.parent?.type === 'atrule' &&
          decl.parent.name === 'property'
            ? decl.parent.params.trim()
            : undefined
        const assigned = decl.prop.startsWith('--') ? decl.prop : registered
        if (assigned) {
          if (global) {
            const values = this.globals.get(assigned) ?? []
            if (!values.includes(decl.value)) values.push(decl.value)
            this.globals.set(assigned, values)
          } else
            this.assignments.push({
              ...at,
              name: /^--[\w-]+$/.test(assigned) ? assigned : '*',
              values: [decl.value],
              unresolved: !/^--[\w-]+$/.test(assigned),
              input: decl.value,
            })
        } else if (colourProperty.test(decl.prop)) {
          this.use(decl.value, at, decl.prop)
        }
      })
    } catch (error) {
      this.notes.push({
        ...site,
        reason: `CSS colour assignments could not be parsed: ${String(error)}`,
      })
    }
  }

  private use(value: string, site: Site, property: string) {
    const variables = variablesIn(value)
    for (const name of variables) this.colours.add(name)
    if (variables.length) this.uses.push({ ...site, property, value, variables })
  }

  /** Called during the existing lexical inventory; detached expressions share its import resolver. */
  program: NonNullable<ControlHooks['program']> = ({ file, path, reference }) => {
    const site = (p: NodePath): Site => ({
      file,
      line: p.node.loc?.start.line ?? 1,
      column: (p.node.loc?.start.column ?? 0) + 1,
      context: owner(p),
    })
    const expr = (node: t.Node, p: NodePath) => expression(node, p, reference)
    const input = (node: t.Node) => canonical(this.syntax(node))
    const add = (p: NodePath, kind: Pending['kind'], node: t.Node, name?: t.Node) =>
      this.pending.push({
        ...site(p),
        kind,
        value: expr(node, p),
        name: name ? expr(name, p) : undefined,
        input: input(node),
      })
    path.traverse({
      JSXAttribute: (p) => {
        const name = property(p.node.name)
        if (!['style', 'className', 'class'].includes(name ?? '')) return
        const value = p.node.value
        if (!value) return
        const node = t.isJSXExpressionContainer(value) ? value.expression : value
        add(p, name === 'style' ? 'object' : 'class', node)
      },
      JSXSpreadAttribute: (p) => {
        add(p, 'props', p.node.argument)
      },
      CallExpression: (p) => {
        if (
          ['!react#createElement', '!react#default.createElement'].includes(
            reference(p.node.callee, p)
          )
        ) {
          if (p.node.arguments[1]) add(p, 'props', p.node.arguments[1])
        }
        const callee = p.node.callee
        if (!t.isMemberExpression(callee)) return
        if (
          member(callee, 'registerProperty') &&
          t.isIdentifier(callee.object, { name: 'CSS' }) &&
          !p.scope.getBinding('CSS') &&
          p.node.arguments[0]
        ) {
          add(p, 'registration', p.node.arguments[0])
        } else if (member(callee, 'setProperty') && p.node.arguments.length >= 2) {
          add(p, 'property', p.node.arguments[1], p.node.arguments[0])
        } else if (member(callee, 'setAttribute')) {
          const [name, value] = p.node.arguments
          if (t.isStringLiteral(name) && value && ['style', 'class'].includes(name.value))
            add(p, name.value === 'style' ? 'css' : 'class', value)
        } else if (
          member(callee, 'assign') &&
          t.isIdentifier(callee.object, { name: 'Object' }) &&
          !p.scope.getBinding('Object')
        ) {
          const [target, ...values] = p.node.arguments
          if (target && this.styleObject(target, p))
            for (const value of values) add(p, 'object', value)
        }
      },
      AssignmentExpression: (p) => {
        const left = p.node.left
        if (!t.isMemberExpression(left)) return
        if (member(left, 'cssText') && this.styleObject(left.object, p)) add(p, 'css', p.node.right)
        else if (member(left, 'className')) add(p, 'class', p.node.right)
        else if (this.styleObject(left.object, p)) {
          const name = left.computed
            ? left.property
            : t.stringLiteral(property(left.property) ?? '')
          add(p, 'property', p.node.right, name)
        }
      },
      /** Class constants/CVA entries must be checked even when passed through an opaque helper. */
      StringLiteral: (p) => {
        if (p.node.value.includes('[--') && !p.findParent((parent) => parent.isJSXAttribute()))
          this.classes(p.node.value, site(p))
      },
    })
  }

  private styleObject(node: t.Node, path: NodePath, seen = new Set<string>()): boolean {
    node = clean(node)
    if (member(node, 'style')) return true
    if (!t.isIdentifier(node) || seen.has(node.name)) return false
    const binding = path.scope.getBinding(node.name)
    return !!(
      binding?.constant &&
      binding.path.isVariableDeclarator() &&
      binding.path.node.init &&
      this.styleObject(binding.path.node.init, binding.path, new Set(seen).add(node.name))
    )
  }

  /** Location/comments do not turn existing debt into a new diff occurrence. */
  private syntax(node: t.Node): unknown {
    return Object.fromEntries(
      Object.entries(node)
        .filter(
          ([key]) =>
            ![
              'loc',
              'start',
              'end',
              'extra',
              'leadingComments',
              'trailingComments',
              'innerComments',
            ].includes(key)
        )
        .map(([key, value]) => [
          key,
          Array.isArray(value)
            ? value.map((item) =>
                item && typeof item === 'object' && 'type' in item
                  ? this.syntax(item as t.Node)
                  : item
              )
            : value && typeof value === 'object' && 'type' in value
              ? this.syntax(value as t.Node)
              : value,
        ])
    )
  }

  private classes(text: string, site: Site) {
    for (const token of text.split(/\s+/)) {
      const base = utility(token).base
      const custom = base.match(/^\[(--[\w-]+):(.+)\]$/)
      const value = (custom?.[2] ?? base).replaceAll('_', ' ')
      if (custom)
        this.assignments.push({
          ...site,
          name: custom[1],
          values: [value],
          unresolved: false,
          input: token,
        })
      else if (
        /^(?:text|bg|border(?:-[trblxyse])?|outline|ring(?:-offset)?|fill|stroke|from|via|to|accent|caret|shadow)-/.test(
          base
        )
      )
        this.use(value, site, 'className')
    }
  }

  finish(statics: StaticInputs): ColourAssignmentReport {
    for (const pending of this.pending) {
      if (pending.kind === 'registration') {
        this.pending.push({
          ...pending,
          kind: 'property',
          name: statics.property(pending.value, 'name'),
          value: statics.property(pending.value, 'initialValue'),
        })
        continue
      }
      if (pending.kind === 'props') {
        const props = statics.input(pending.value, pending.input)
        for (const name of ['style', 'className', 'class']) {
          if (props.properties?.[name])
            this.pending.push({
              ...pending,
              kind: name === 'style' ? 'object' : 'class',
              value: statics.property(pending.value, name),
            })
        }
        if (
          statics.evaluate(statics.property(pending.value, '--colour-assignment-unknown-prop'))
            .unknown
        )
          this.notes.push({
            file: pending.file,
            line: pending.line,
            context: pending.context,
            reason:
              'Opaque JSX/createElement props may carry style/class assignments; no colour approval is inferred',
          })
        continue
      }
      if (pending.kind === 'object') {
        const object = statics.input(pending.value, pending.input)
        const helper = statics.functionDerived(pending.value)
        for (const [name, value] of Object.entries(object.properties ?? {})) {
          const values = (value.values ?? []).map(String)
          if (name.startsWith('--'))
            this.assignments.push({
              ...pending,
              name,
              values,
              unresolved: value.unresolved || !values.length || !!value.mayBeUndefined,
              input: pending.input,
            })
          else if (colourProperty.test(kebab(name))) {
            const concrete = (value.values ?? [])
              .filter((candidate) => candidate !== null && candidate !== false)
              .map(String)
            for (const text of concrete) this.use(text, pending, kebab(name))
            if (value.unresolved)
              this.notes.push({
                file: pending.file,
                line: pending.line,
                context: pending.context,
                reason: `Dynamic ${kebab(name)} style value has unresolved provenance; user, provider and customer inputs need context`,
              })
            if (helper || concrete.length > 0)
              this.assignments.push({
                ...pending,
                name: kebab(name),
                values: concrete,
                unresolved: value.unresolved || !values.length,
                input: pending.input,
                direct: true,
              })
          }
        }
        if (
          statics.evaluate(statics.property(pending.value, '--colour-assignment-unknown-key'))
            .unknown
        )
          this.assignments.push({
            ...pending,
            name: '*',
            values: [],
            unresolved: true,
            input: pending.input,
          })
        continue
      }
      const evaluated = statics.evaluate(pending.value)
      const values = evaluated.values.map(String)
      if (pending.kind === 'property') {
        const names = statics.evaluate(pending.name ?? unknown)
        for (const name of names.values.filter((v): v is string => typeof v === 'string')) {
          if (name.startsWith('--'))
            this.assignments.push({
              ...pending,
              name,
              values,
              unresolved: evaluated.unknown || evaluated.undefined || !values.length,
              input: pending.input,
            })
          else if (colourProperty.test(kebab(name))) {
            this.assignments.push({
              ...pending,
              name: kebab(name),
              values,
              unresolved: evaluated.unknown || evaluated.undefined || !values.length,
              input: pending.input,
              direct: true,
            })
            for (const value of values) this.use(value, pending, kebab(name))
          }
        }
        if (names.unknown || names.undefined || !names.values.length)
          this.assignments.push({
            ...pending,
            name: '*',
            values,
            unresolved: true,
            input: `${canonical(pending.name)} = ${pending.input}`,
          })
      } else if (pending.kind === 'css') {
        for (const value of values) this.css(`x { ${value} }`, pending)
        if (evaluated.unknown || evaluated.undefined)
          this.assignments.push({
            ...pending,
            name: '*',
            values: [],
            unresolved: true,
            input: pending.input,
          })
      } else {
        for (const value of values) this.classes(value, pending)
        if (evaluated.unknown && pending.input.includes('[--')) {
          const names = [...pending.input.matchAll(/\[(--[\w-]+):/g)].map((match) => match[1])
          for (const name of new Set(names.length ? names : ['*']))
            this.assignments.push({
              ...pending,
              name,
              values: [],
              unresolved: true,
              input: pending.input,
            })
        }
      }
    }
    const byName = new Map<string, Assignment[]>()
    /** The same literal can be visited as a class constant and its JSX use. Preserve authored sites. */
    const assignments = [
      ...new Map(
        this.assignments.map((a) => {
          const assignment: Assignment = {
            file: a.file,
            line: a.line,
            column: a.column,
            context: a.context,
            name: a.name,
            values: a.values,
            unresolved: a.unresolved,
            input: a.input,
            ...(a.direct ? { direct: true } : {}),
          }
          return [canonical([a.file, a.line, a.column, a.name, a.values, a.unresolved]), assignment]
        })
      ).values(),
    ]
    for (const assignment of assignments) {
      if (assignment.direct) continue
      const writers = byName.get(assignment.name) ?? []
      writers.push(assignment)
      byName.set(assignment.name, writers)
      if (
        assignment.values.some(
          (value) => rawColours(value) || variablesIn(value).some((name) => this.globalColour(name))
        )
      )
        this.colours.add(assignment.name)
    }
    /** Unknown aliases have no proven colour provenance until a colour sink or literal establishes it. */
    const defined = (name: string, seen = new Set<string>()): boolean => {
      if (seen.has(name) || seen.size >= 20) return false
      const global = this.globals.get(name)?.filter((value) => value.trim() !== `var(${name})`)
      const writers = byName.get(name)
      const values = global?.length ? global : writers?.flatMap((writer) => writer.values)
      if (!values?.length || (!global?.length && writers?.some((writer) => writer.unresolved)))
        return false
      return values.every((value) =>
        variablesIn(value).every((ref) => defined(ref, new Set(seen).add(name)))
      )
    }
    for (const assignment of assignments)
      if (
        assignment.values.some(
          (value) => !dimensional(value) && variablesIn(value).some((name) => !defined(name))
        )
      )
        this.notes.push({
          file: assignment.file,
          line: assignment.line,
          context: assignment.context,
          reason: `Unresolved custom-property alias ${assignment.name}; colour ownership is unknown; input: ${assignment.input.slice(0, 240)}`,
        })
    /** Colour use propagates backwards through aliases, never from spelling like '--colour'. */
    let changed = true
    while (changed) {
      changed = false
      for (const name of [...this.colours])
        for (const assignment of byName.get(name) ?? [])
          for (const value of assignment.values)
            for (const dependency of variablesIn(value))
              if (!this.colours.has(dependency)) {
                this.colours.add(dependency)
                changed = true
              }
    }
    const records: ColourAssignmentReport['assignments'] = []
    const findings: InventoryFinding[] = []
    const checkVariable = (name: string, seen: Set<string>, channels = false): Check => {
      if (name.startsWith('--landing-'))
        return {
          status: 'invalid',
          reason: `Landing-only token is not product colour authority: ${name}`,
          references: [name],
        }
      if (seen.has(name) || seen.size >= 20)
        return {
          status: 'unresolved',
          reason: `Cyclic or over-depth colour alias: ${name}`,
          references: [],
        }
      const next = new Set(seen).add(name)
      if (this.globals.has(name)) {
        if (!this.globalColour(name, new Set(), channels))
          return {
            status: 'invalid',
            reason: `Global variable is not a resolved colour token: ${name}`,
            references: [name],
          }
        const overrides = byName.get(name) ?? []
        const checks = overrides.map((writer) => checkAssignment(writer, next, channels))
        const dependencies = (this.globals.get(name) ?? [])
          .filter((value) => value.trim() !== `var(${name})`)
          .flatMap((value) => colourReferences(value, channels))
        return combine([
          { status: 'verified', reason: 'Existing global colour', references: [name] },
          ...dependencies.map((dependency) =>
            checkVariable(dependency.name, next, dependency.channels)
          ),
          ...checks,
        ])
      }
      const writers = byName.get(name)
      if (!writers?.length)
        return {
          status: 'invalid',
          reason: `No definition in globals.css or checked local assignment: ${name}`,
          references: [],
        }
      return combine(writers.map((writer) => checkAssignment(writer, next, channels)))
    }
    const completeShadow = (value: string, seen = new Set<string>()): boolean => {
      const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim())
      if (alias) {
        const name = alias[1]
        if (seen.has(name) || seen.size >= 12 || (byName.get(name) ?? []).length) return false
        const definitions = this.globals.get(name)?.filter((v) => v.trim() !== `var(${name})`)
        return (
          !!definitions?.length &&
          definitions.every((v) => completeShadow(v, new Set(seen).add(name)))
        )
      }
      const nodes = valueParser(value).nodes
      const groups: valueParser.Node[][] = [[]]
      for (const node of nodes) {
        if (node.type === 'div' && node.value === ',') groups.push([])
        else if (node.type !== 'space' && node.type !== 'comment') groups.at(-1)!.push(node)
      }
      return groups.every((group) => {
        const lengths = group.filter(
          (node) =>
            node.type === 'word' &&
            /^(?:0|[+-]?(?:\d*\.)?\d+(?:px|rem|em|vh|vw|vmin|vmax|ch|ex))$/.test(node.value)
        )
        if (lengths.length < 2 || lengths.length > 4) return false
        let colours = 0
        let inset = 0
        return group.every((node) => {
          if (lengths.includes(node)) return true
          if (node.type === 'word' && node.value === 'inset') return ++inset <= 1
          const colour = valueParser.stringify(node)
          const references = variablesIn(colour)
          if (
            references.some((name) => !this.globalColour(name) || (byName.get(name) ?? []).length)
          )
            return false
          if (colour === 'transparent' || references.length > 0 || rawColours(colour))
            return ++colours <= 1
          return false
        })
      })
    }
    const checkAssignment = (
      assignment: Assignment,
      seen: Set<string>,
      channels = false
    ): Check => {
      if (assignment.name === '*')
        return {
          status: 'unresolved',
          reason:
            'Unknown style key or spread may assign a colour; cannot verify against globals.css',
          references: [],
        }
      const shadowSink = assignment.direct && /^(?:box|text)-shadow$/.test(assignment.name)
      const checks = assignment.values.map((value): Check => {
        const border = assignment.direct ? borderDeclarations(assignment.name, value) : null
        if (border) {
          const paint = border.filter((declaration) => declaration.category === 'colours')
          if (!paint.length)
            return {
              status: 'verified',
              reason: 'Border shorthand authors no colour',
              references: [],
            }
          return combine(
            paint.map((declaration) =>
              checkColourValue(declaration.value, (name, context) =>
                checkVariable(name, seen, context)
              )
            )
          )
        }
        if (assignment.direct && /^none$/i.test(value.trim()))
          return /^(?:background(?:-image)?|fill|stroke|box-shadow|text-shadow|text-decoration)$/.test(
            assignment.name
          )
            ? { status: 'verified', reason: 'No authored paint colour', references: [] }
            : {
                status: 'invalid',
                reason: `none is not a colour for ${assignment.name}`,
                references: [],
              }
        const shadow = shadowSink ? /^var\((--shadow-[\w-]+)\)$/.exec(value.trim()) : null
        if (shadow) {
          const name = shadow[1]
          const definitions = this.globals
            .get(name)
            ?.filter((definition) => definition.trim() !== `var(${name})`)
          if (
            definitions?.length &&
            definitions.every((definition) => completeShadow(definition))
          ) {
            // A complete shadow recipe belongs to globals.css. A local writer
            // can replace its geometry/paint at runtime, so it is not approved.
            if ((byName.get(name) ?? []).length)
              return {
                status: 'unresolved',
                reason: `Global shadow ${name} has a checked local override`,
                references: [name],
              }
            return { status: 'verified', reason: 'Existing global shadow', references: [name] }
          }
        }
        const plainVariable = shadowSink ? /^var\((--[\w-]+)\)$/.exec(value.trim()) : null
        if (plainVariable && this.globalColour(plainVariable[1]))
          return {
            status: 'invalid',
            reason: `Global colour ${plainVariable[1]} is not a complete shadow recipe`,
            references: [plainVariable[1]],
          }
        return checkColourValue(
          value,
          (name, context) => checkVariable(name, seen, context),
          shadowSink,
          channels
        )
      })
      if (assignment.unresolved)
        checks.push({
          status: 'unresolved',
          reason: 'Runtime value, computed key or spread cannot be verified against globals.css',
          references: [],
        })
      return combine(checks)
    }
    for (const use of this.uses) {
      if (!use.file.endsWith('.css') || centralFile(use.file)) continue
      if (
        use.variables.some(
          (name) =>
            checkVariable(name, new Set(), true).status === 'verified' &&
            checkVariable(name, new Set()).status !== 'verified'
        )
      )
        assignments.push({
          ...use,
          name: use.property,
          values: [use.value],
          unresolved: false,
          input: use.value,
          direct: true,
        })
    }
    for (const assignment of assignments.sort(
      (a, b) =>
        compare(a.file, b.file) || a.line - b.line || a.column - b.column || compare(a.name, b.name)
    )) {
      if (
        centralFile(assignment.file) ||
        (!assignment.direct && assignment.name !== '*' && !this.colours.has(assignment.name))
      )
        continue
      const check = checkAssignment(assignment, new Set([assignment.name]), !assignment.direct)
      records.push({ ...assignment, ...check })
      if (check.status === 'verified') continue
      if (check.status === 'unresolved') {
        this.notes.push({
          file: assignment.file,
          line: assignment.line,
          context: assignment.context,
          reason: `Unresolved colour assignment ${assignment.name}: ${check.reason}; input: ${assignment.input.slice(0, 240)}`,
        })
        continue
      }
      const value = canonical({
        variable: assignment.name,
        values: assignment.values,
        ...(assignment.unresolved ? { expression: assignment.input } : {}),
        status: check.status,
        reason: check.reason,
      })
      const id = hash(
        canonical([assignment.file, assignment.line, assignment.column, assignment.context, value])
      )
      findings.push({
        id,
        observedFrom: [assignment.file],
        kind: 'usage-violation',
        contract: 'central-colour-assignment',
        rule: 'central-colour-assignment',
        category: 'colours',
        property: assignment.name,
        value,
        ...assignment,
        reason: check.reason,
        provenance: {
          source: `${TOKEN_FILE}#colour-tokens`,
          input: value,
          permitted:
            'Every assigned colour, conditional branch and fallback must resolve to an existing global colour token; runtime values remain flagged',
          composition: assignment.context,
        },
      })
    }
    return {
      version: '1.0.0',
      findings,
      unchecked: this.notes.sort((a, b) => compare(canonical(a), canonical(b))),
      assignments: records,
      variables: [...new Set([...this.colours, ...this.globals.keys()])]
        .sort(compare)
        .map((name) => ({
          name,
          global: this.globals.has(name),
          writers: byName.get(name)?.length ?? 0,
          ...checkVariable(name, new Set(), true),
          complete: checkVariable(name, new Set()).status === 'verified',
        })),
      uses: [...new Map(this.uses.map((use) => [canonical(use), use])).values()].sort((a, b) =>
        compare(canonical(a), canonical(b))
      ),
      verifiedUsages: [],
      coverage: {
        checked: records.length,
        verified: records.filter((r) => r.status === 'verified').length,
        invalid: records.filter((r) => r.status === 'invalid').length,
        unresolved: records.filter((r) => r.status === 'unresolved').length,
      },
    }
  }

  globalColour(name: string, seen = new Set<string>(), allowChannels = true): boolean {
    if (seen.has(name) || seen.size >= 20) return false
    const values = this.globals.get(name)?.filter((value) => value.trim() !== `var(${name})`)
    if (!values?.length) return false
    const next = new Set(seen).add(name)
    return values.every((value) => {
      const nodes = valueParser(value).nodes.filter(
        (node) => node.type !== 'space' && node.type !== 'comment'
      )
      const channels = /^\d+(?:\.\d+)?(?:deg)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/.test(
        value.trim()
      )
      if (channels && !allowChannels) return false
      if (
        !channels &&
        (nodes.length !== 1 ||
          (nodes[0].type === 'function' &&
            ![
              'var',
              'rgb',
              'rgba',
              'hsl',
              'hsla',
              'hwb',
              'lab',
              'lch',
              'oklab',
              'oklch',
              'color',
              'color-mix',
              'light-dark',
            ].includes(nodes[0].value)))
      )
        return false
      const refs = colourReferences(value, allowChannels)
      return refs.length
        ? refs.every((ref) => this.globalColour(ref.name, next, ref.channels))
        : rawColours(value) ||
            /^(?:transparent|currentColor|\d+(?:\.\d+)?(?:deg)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%)$/.test(
              value.trim()
            )
    })
  }
}

/** Preserve the channel context of each variable rather than treating channels as complete paint. */
function colourReferences(value: string, channels = false): { name: string; channels: boolean }[] {
  const refs: { name: string; channels: boolean }[] = []
  const visit = (nodes: valueParser.Node[], context: boolean) => {
    for (const node of nodes) {
      if (node.type !== 'function') continue
      if (node.value === 'var') {
        const comma = node.nodes.findIndex((part) => part.type === 'div' && part.value === ',')
        const name = valueParser
          .stringify(comma < 0 ? node.nodes : node.nodes.slice(0, comma))
          .trim()
        if (/^--[\w-]+$/.test(name)) refs.push({ name, channels: context })
        if (comma >= 0) visit(node.nodes.slice(comma + 1), context)
      } else visit(node.nodes, ['hsl', 'hsla', 'rgb', 'rgba'].includes(node.value) || context)
    }
  }
  visit(valueParser(value).nodes, channels)
  return refs
}

function checkColourValue(
  text: string,
  variable: (name: string, channels: boolean) => Check,
  shadowGeometry = false,
  channelContext = false
): Check {
  if (/^transparent$/i.test(text.trim()))
    return { status: 'verified', reason: 'No authored paint colour', references: [] }
  if (/^none$/i.test(text.trim()))
    return {
      status: 'unresolved',
      reason: 'none requires a known paint property context',
      references: [],
    }
  if (/^(?:currentColor|inherit|unset|revert|revert-layer)$/i.test(text.trim()))
    return {
      status: 'unresolved',
      reason: 'Inherited colour requires runtime cascade; no global origin is proven',
      references: [],
    }
  const checks: Check[] = []
  const visit = (nodes: valueParser.Node[], insideMix = false, channels = channelContext) => {
    for (const node of nodes) {
      if (node.type === 'space' || node.type === 'comment' || node.type === 'div') continue
      if (node.type === 'function') {
        if (node.unclosed) {
          checks.push({ status: 'invalid', reason: 'Malformed colour value', references: [] })
          continue
        }
        if (node.value === 'var') {
          const comma = node.nodes.findIndex((part) => part.type === 'div' && part.value === ',')
          const key = valueParser
            .stringify(comma < 0 ? node.nodes : node.nodes.slice(0, comma))
            .trim()
          checks.push(
            /^--[\w-]+$/.test(key)
              ? variable(key, channels)
              : { status: 'invalid', reason: 'Invalid CSS variable reference', references: [] }
          )
          if (comma >= 0) {
            const fallback = node.nodes.slice(comma + 1)
            if (!valueParser.stringify(fallback).trim())
              checks.push({ status: 'invalid', reason: 'Empty colour fallback', references: [] })
            else visit(fallback, insideMix, channels)
          }
        } else if (['rgb', 'rgba', 'hsl', 'hsla'].includes(node.value)) {
          if (
            !/^var\(--[\w-]+\)(?:\s*\/\s*[\d.%]+)?$/.test(valueParser.stringify(node.nodes).trim())
          )
            checks.push({
              status: 'invalid',
              reason: 'Colour channels must come from a global token, not literal channel values',
              references: [],
            })
          visit(node.nodes, true, true)
        } else if (
          [
            'color-mix',
            'light-dark',
            'linear-gradient',
            'radial-gradient',
            'conic-gradient',
            'calc',
          ].includes(node.value)
        )
          visit(node.nodes, true, channels)
        else
          checks.push({
            status: 'unresolved',
            reason: `Unsupported colour expression: ${node.value}()`,
            references: [],
          })
      } else if (
        node.type !== 'word' ||
        !(
          (insideMix || shadowGeometry) &&
          /^(?:in|inset|from|srgb|srgb-linear|oklab|oklch|hsl|hwb|lab|lch|xyz|shorter|longer|increasing|decreasing|hue|transparent|to|top|bottom|left|right|[-+*/]|[+-]?(?:\d*\.)?\d+(?:%|deg|px|rem|em)?)$/.test(
            node.value
          )
        )
      ) {
        checks.push({
          status: 'invalid',
          reason: `Literal or non-global colour value: ${valueParser.stringify(node)}`,
          references: [],
        })
      }
    }
  }
  visit(valueParser(text).nodes)
  const result = combine(checks)
  if (result.status === 'verified' && !result.references.length)
    return {
      ...result,
      status: 'invalid',
      reason: 'Assigned colour has no global colour reference',
    }
  return result
}

/** Resolve the entire emitted colour value, including every fallback, against all known writers. */
export function withoutVerifiedColourUsages<T extends Finding>(
  findings: T[],
  report: ColourAssignmentReport
): T[] {
  const variables = new Map(report.variables.map((item) => [item.name, item]))
  const retained = findings.filter((finding) => {
    if (finding.rule !== 'central-colour' || finding.kind === 'system-change') return true
    const names = variablesIn(finding.value)
    // Only resolve local alias provenance; do not broaden unrelated colour/style policy.
    if (!names.some((name) => variables.get(name)?.global === false)) return true
    const result = checkColourValue(finding.value, (name, channels) => {
      const variable = variables.get(name)
      if (variable?.status === 'verified' && !variable.complete && !channels)
        return {
          status: 'invalid',
          reason: `Channel token ${name} requires a colour function`,
          references: [name],
        }
      return (
        variable ?? {
          status: 'unresolved',
          reason: `Uninspected colour variable: ${name}`,
          references: [],
        }
      )
    })
    if (result.status !== 'verified') return true
    report.verifiedUsages.push({
      file: finding.file,
      line: finding.line,
      column: finding.column,
      context: finding.context,
      property: finding.property,
      value: finding.value,
      variables: names,
      references: result.references,
    })
    return false
  })
  report.verifiedUsages = [
    ...new Map(report.verifiedUsages.map((use) => [canonical(use), use])).values(),
  ].sort((a, b) => compare(canonical(a), canonical(b)))
  return retained
}

/** Removing the last valid writer must flag unchanged uses, not silently become old usage debt. */
export function removedColourAliasFindings(
  before: ColourAssignmentReport,
  after: ColourAssignmentReport
): InventoryFinding[] {
  const previous = new Map(before.variables.map((item) => [item.name, item]))
  const removed = new Set(
    after.variables
      .filter((item) => {
        const old = previous.get(item.name)
        return (
          !item.global &&
          item.writers === 0 &&
          old &&
          !old.global &&
          old.writers > 0 &&
          old.status === 'verified'
        )
      })
      .map((item) => item.name)
  )
  return after.uses
    .filter((use) => !centralFile(use.file) && use.variables.some((name) => removed.has(name)))
    .map((use) => ({
      ...use,
      id: hash(canonical(['removed-colour-alias', use])),
      observedFrom: [use.file],
      kind: 'usage-violation',
      contract: 'central-colour',
      rule: 'central-colour',
      category: 'colours',
      reason: `Previously verified colour alias lost its last checked assignment: ${use.variables.filter((name) => removed.has(name)).join(', ')}`,
      provenance: {
        source: `${TOKEN_FILE}#colour-tokens`,
        input: use.value,
        permitted: 'Every local colour alias must retain verified global-token assignments',
      },
    }))
}

function combine(checks: Check[]): Check {
  const status = checks.some((check) => check.status === 'invalid')
    ? 'invalid'
    : !checks.length || checks.some((check) => check.status === 'unresolved')
      ? 'unresolved'
      : 'verified'
  return {
    status,
    reason:
      [
        ...new Set(
          checks.filter((check) => check.status !== 'verified').map((check) => check.reason)
        ),
      ]
        .sort(compare)
        .join('; ') ||
      (checks.length
        ? 'All assigned alternatives resolve to globals.css'
        : 'No verifiable assigned colour'),
    references: [...new Set(checks.flatMap((check) => check.references))].sort(compare),
  }
}
