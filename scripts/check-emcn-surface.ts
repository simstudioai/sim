#!/usr/bin/env bun
/**
 * Freezes the public surface of the modern design packages. The design owner's rule: legacy
 * components stay custom or `emcn-legacy`, new work composes EMCN as it stands, and nothing is added
 * to EMCN, so no attribute, variant or option is passed through to it. The surface is recorded in
 * `scripts/emcn-surface.json`; any difference fails. Only the design owner (CODEOWNERS) changes EMCN
 * or regenerates the snapshot with `--update`: compose the existing component instead.
 *
 * Per export subpath it records the exported names, and each component's props and each other
 * exported function's parameters as a type shape: literal values, opaque type names (`‹string›`),
 * and the members of the objects, arrays (`[]`) and callbacks (`()`, returning `⇒`) declared in the
 * package, to `MAX_DEPTH`. React and DOM attributes are named by their declaring interface under `…inherited`.
 * An exported stylesheet records its custom properties, its selectors and at-rules, and a fingerprint
 * of each rule's declarations, so a token's value counts; each CSS Module class records a
 * fingerprint of the declarations of every rule that names it. Every non-test file under a frozen
 * package's `src/` records a content fingerprint, so a change to a component's logic fails too:
 * TypeScript is read as its syntax tree and CSS as its rules, so reformatting or a comment is no
 * change.
 *
 * `@sim/emcn-auth` and `@sim/emcn-docs` are frozen with `@sim/emcn` and `@sim/emcn-platform`: the
 * design owner is their only author (`git log --format=%an -- packages/emcn-auth packages/emcn-docs`).
 *
 * Run: `bun run check:emcn-surface` (`-- --update` rewrites the snapshot)
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import postcss from 'postcss'
import { emcnPackages, emcnTypeScriptPaths } from './emcn-packages'
import { localBin } from './local-bin'
import { listRepoFiles } from './repo-files'

const FROZEN = new Set(['@sim/emcn', '@sim/emcn-auth', '@sim/emcn-docs', '@sim/emcn-platform'])
const SNAPSHOT = 'scripts/emcn-surface.json'
/** How many levels of objects, arrays and callbacks are recorded, counting the prop itself. */
const MAX_DEPTH = 5

/**
 * A type's literal values and opaque type names, sorted; or, when it admits an object, array or
 * callback declared in a frozen package, a record of their members with the rest under `…types`.
 */
type TypeShape = string[] | { [key: string]: TypeShape }
type Members = Record<string, TypeShape>
interface SubpathSurface {
  names: string[]
  props: Record<string, Members>
  params: Record<string, Members>
}
interface StylesheetSurface {
  properties: string[]
  selectors: string[]
  /** Each rule's selector (or at-rule) with a fingerprint of its declarations. */
  declarations: Record<string, string>
}
interface PackageSurface {
  exports: Record<string, SubpathSurface | StylesheetSurface | 'asset'>
  classes: Record<string, Record<string, string>>
  /** Each source file under `src/` with a fingerprint of its content. */
  sources: Record<string, string>
}
type Surface = Record<string, PackageSurface>

const sorted = <T>(values: Iterable<T>) => [...values].sort()
const byKey = <T>(entries: [string, T][]) =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
/** CSS text with whitespace collapsed and dropped around punctuation: reformatting is no change. */
const normalizeCss = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\s*([,>+~(){}:;])\s*/g, '$1')
    .trim()

const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** The at-rules enclosing `node`, outermost first, each followed by a space. */
function cssContext(node: postcss.Node) {
  let context = ''
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule') {
      const rule = parent as postcss.AtRule
      context = `${normalizeCss(`@${rule.name} ${rule.params}`)} ${context}`
    }
  }
  return context
}

/** A rule's or at-rule's own declarations, normalized: `prop:value`, in order, `;`-joined. */
function declarationText(node: postcss.Container) {
  return (node.nodes ?? [])
    .filter((child): child is postcss.Declaration => child.type === 'decl')
    .map((decl) => `${decl.prop}:${normalizeCss(decl.value)}${decl.important ? '!important' : ''}`)
    .join(';')
}

/** A stylesheet as its rules and declarations, so reformatting and comments are no change. */
function normalizedStylesheet(text: string) {
  const lines: string[] = []
  const root = postcss.parse(text)
  if (declarationText(root)) lines.push(`{${declarationText(root)}}`)
  root.walk((node) => {
    if (node.type === 'rule')
      lines.push(`${cssContext(node)}${normalizeCss(node.selector)}{${declarationText(node)}}`)
    if (node.type === 'atrule')
      lines.push(
        `${cssContext(node)}${normalizeCss(`@${node.name} ${node.params}`)}{${declarationText(node)}}`
      )
  })
  return lines.join('\n')
}

function stylesheetSurface(file: string): StylesheetSurface {
  const properties = new Set<string>()
  const selectors = new Set<string>()
  const declarations = new Map<string, string[]>()
  const record = (key: string, node: postcss.Container) => {
    selectors.add(key)
    const text = declarationText(node)
    if (text) declarations.set(key, [...(declarations.get(key) ?? []), text])
  }
  postcss.parse(readFileSync(file, 'utf8')).walk((node) => {
    if (node.type === 'decl' && node.prop.startsWith('--')) properties.add(node.prop)
    if (node.type === 'rule') record(cssContext(node) + normalizeCss(node.selector), node)
    if (node.type === 'atrule')
      record(cssContext(node) + normalizeCss(`@${node.name} ${node.params}`), node)
  })
  return {
    properties: sorted(properties),
    selectors: sorted(selectors),
    declarations: byKey(
      [...declarations].map(([key, texts]): [string, string] => [
        key,
        fingerprint(texts.join('\n')),
      ])
    ),
  }
}

/**
 * TypeScript as its syntax tree: each node's kind with its name, literal, operator or declaration
 * keyword. Whitespace, comments, separators and parentheses (the tree already holds precedence)
 * leave no trace, so only a change to the code counts.
 */
function normalizedScript(text: string, file: string) {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, false, kind)
  const parts: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isParenthesizedExpression(node) || ts.isParenthesizedTypeNode(node)) {
      ts.forEachChild(node, visit)
      return
    }
    if (ts.isJsxText(node)) {
      const words = node.text.replace(/\s+/g, ' ').trim()
      if (words) parts.push(`text:${words}`)
      return
    }
    const fields = node as ts.Node & { text?: unknown; operator?: unknown; token?: unknown }
    let part = ts.SyntaxKind[node.kind]
    if (typeof fields.text === 'string' && !ts.isSourceFile(node)) part += `:${fields.text}`
    if (typeof fields.operator === 'number') part += `:${ts.SyntaxKind[fields.operator]}`
    if (typeof fields.token === 'number') part += `:${ts.SyntaxKind[fields.token]}`
    if (ts.isVariableDeclarationList(node))
      part += `:${node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using)}`
    parts.push(part)
    parts.push('(')
    ts.forEachChild(node, visit)
    parts.push(')')
  }
  visit(source)
  return parts.join(' ')
}

/** A fingerprint of a source file's content, read as code or rules where the file is either. */
function sourceFingerprint(file: string) {
  const text = readFileSync(file, 'utf8')
  if (/\.[cm]?[jt]sx?$/.test(file)) return fingerprint(normalizedScript(text, file))
  if (file.endsWith('.css')) return fingerprint(normalizedStylesheet(text))
  return fingerprint(text.replace(/\r\n/g, '\n').trim())
}

const isTestFile = (file: string) => /\.test\.[cm]?[jt]sx?$/.test(file)

/** Each class a CSS Module names, with a fingerprint of the rules (and declarations) naming it. */
function classFingerprints(file: string) {
  const rules = new Map<string, string[]>()
  postcss.parse(readFileSync(file, 'utf8')).walkRules((rule) => {
    const declarations = (rule.nodes ?? [])
      .filter((node): node is postcss.Declaration => node.type === 'decl')
      .map(
        (decl) => `${decl.prop}:${normalizeCss(decl.value)}${decl.important ? '!important' : ''}`
      )
    const text = `${cssContext(rule)}${normalizeCss(rule.selector)}{${declarations.join(';')}}`
    for (const [, name] of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      rules.set(name, [...(rules.get(name) ?? []), text])
    }
  })
  return byKey(
    [...rules].map(([name, texts]): [string, string] => [name, fingerprint(texts.join('\n'))])
  )
}

/** Reads the frozen packages' surface from the tree at `root`. */
function readSurface(root: string): Surface {
  const owners = emcnPackages(root).filter((owner) => FROZEN.has(owner.name))
  const files = listRepoFiles(root)
  const entries = owners.flatMap((owner) =>
    Object.entries(owner.manifest.exports ?? {}).map(([key, target]) => {
      const value = typeof target === 'string' ? target : (target.types ?? target.default ?? '')
      return { owner: owner.name, key, file: path.resolve(owner.directory, value) }
    })
  )
  const program = ts.createProgram(
    entries.filter(({ file }) => /\.tsx?$/.test(file)).map(({ file }) => file),
    {
      strictNullChecks: true,
      types: [],
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: emcnTypeScriptPaths(emcnPackages(root)),
    }
  )
  const checker = program.getTypeChecker()
  const packagesRoot = path.join(root, 'packages') + path.sep
  const inPackages = (node: ts.Node | undefined) => {
    const file = node?.getSourceFile().fileName
    return !!file?.startsWith(packagesRoot) && !file.includes('/node_modules/')
  }
  /** A type declared outside the packages (React, the DOM, the standard library): named, not walked. */
  const isLibrary = (type: ts.Type) => {
    const declarations = (type.aliasSymbol ?? type.getSymbol())?.declarations ?? []
    return declarations.length > 0 && !declarations.some(inPackages)
  }
  const isObject = (type: ts.Type): boolean =>
    !!(type.flags & ts.TypeFlags.Object) ||
    (type.isIntersection() && type.types.every((part) => part.flags & ts.TypeFlags.Object))
  /**
   * A type's name: an anonymous package object past `MAX_DEPTH` is `‹…›`, and a long expansion keeps
   * its start and a hash of the rest, so the snapshot stays readable but still changes with it.
   */
  function opaque(type: ts.Type) {
    const anonymous = !type.aliasSymbol && !/^[A-Z]/.test(type.getSymbol()?.name ?? '')
    if (isObject(type) && !isLibrary(type) && anonymous) return '‹…›'
    const text = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
    if (text.length <= 120) return `‹${text}›`
    return `‹${text.slice(0, 80)}… #${createHash('sha256').update(text).digest('hex').slice(0, 8)}›`
  }

  function shapeOf(types: readonly ts.Type[], depth: number): TypeShape {
    const tokens = new Set<string>()
    const elements: ts.Type[] = []
    const callbacks: ts.Signature[] = []
    const objects: ts.Type[] = []
    for (const type of types) {
      const named = type.aliasSymbol && isLibrary(type)
      for (const member of named || !type.isUnion() ? [type] : type.types) {
        if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue
        if (member.isStringLiteral() || member.isNumberLiteral()) tokens.add(String(member.value))
        else if (member.flags & ts.TypeFlags.BooleanLiteral)
          tokens.add((member as ts.Type & { intrinsicName: string }).intrinsicName)
        else if (depth >= MAX_DEPTH) tokens.add(opaque(member))
        else if (checker.isArrayType(member) || checker.isTupleType(member))
          elements.push(...checker.getTypeArguments(member as ts.TypeReference))
        else if (isLibrary(member) || !isObject(member)) tokens.add(opaque(member))
        else if (member.getCallSignatures().length && !member.getProperties().length)
          callbacks.push(...member.getCallSignatures())
        else objects.push(member)
      }
    }
    const record: Members = {}
    if (elements.length) record['[]'] = shapeOf(elements, depth + 1)
    if (callbacks.length)
      record['()'] = {
        ...parametersOf(callbacks, depth + 1),
        '⇒': shapeOf(
          callbacks.map((signature) => signature.getReturnType()),
          depth + 1
        ),
      }
    if (objects.length) Object.assign(record, membersOf(objects, depth + 1))
    if (!Object.keys(record).length) return sorted(tokens)
    if (tokens.size) record['…types'] = sorted(tokens)
    return byKey(Object.entries(record))
  }

  /** The properties of `types`, merged by name; those declared outside the packages by interface. */
  function membersOf(types: readonly ts.Type[], depth: number): Members {
    const own = new Map<string, ts.Type[]>()
    const inherited = new Set<string>()
    for (const type of types) {
      for (const member of type.isUnion() ? type.types : [type]) {
        for (const prop of checker.getPropertiesOfType(checker.getApparentType(member))) {
          const owner = prop.declarations?.[0]?.parent
          if (!inPackages(owner)) {
            const name = owner && (ts.isInterfaceDeclaration(owner) ? owner.name.text : undefined)
            inherited.add(name ?? 'anonymous')
            continue
          }
          own.set(prop.name, [...(own.get(prop.name) ?? []), checker.getTypeOfSymbol(prop)])
        }
      }
    }
    const record: Members = {}
    for (const [name, propTypes] of own) record[name] = shapeOf(propTypes, depth)
    if (inherited.size) record['…inherited'] = sorted(inherited)
    return byKey(Object.entries(record))
  }

  /** The parameters of `signatures`, merged by name. */
  function parametersOf(signatures: readonly ts.Signature[], depth: number): Members {
    const parameters = new Map<string, ts.Type[]>()
    for (const signature of signatures) {
      for (const parameter of signature.getParameters()) {
        const types = parameters.get(parameter.name) ?? []
        parameters.set(parameter.name, [...types, checker.getTypeOfSymbol(parameter)])
      }
    }
    return byKey([...parameters].map(([name, types]) => [name, shapeOf(types, depth)]))
  }

  function subpathSurface(file: string): SubpathSurface {
    const source = program.getSourceFile(file)
    const module = source && checker.getSymbolAtLocation(source)
    const names: string[] = []
    const props: SubpathSurface['props'] = {}
    const params: SubpathSurface['params'] = {}
    for (const symbol of module ? checker.getExportsOfModule(module) : []) {
      names.push(symbol.name)
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      const declaration = target.valueDeclaration
      if (!declaration) continue
      const [signature] = checker.getTypeOfSymbolAtLocation(target, declaration).getCallSignatures()
      if (!signature) continue
      if (!/^[A-Z]/.test(symbol.name)) {
        params[symbol.name] = parametersOf([signature], 1)
        continue
      }
      const [parameter] = signature.getParameters()
      if (parameter) props[symbol.name] = membersOf([checker.getTypeOfSymbol(parameter)], 1)
    }
    return {
      names: sorted(names),
      props: byKey(Object.entries(props)),
      params: byKey(Object.entries(params)),
    }
  }

  const surface: Surface = {}
  for (const owner of owners) {
    const prefix = `${path.relative(root, owner.directory)}/`
    const classes = files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.module.css'))
      .map((file): [string, Record<string, string>] => [
        file.slice(prefix.length),
        classFingerprints(path.join(root, file)),
      ])
    const sources = files
      .filter((file) => file.startsWith(`${prefix}src/`) && !isTestFile(file))
      .map((file): [string, string] => [
        file.slice(prefix.length),
        sourceFingerprint(path.join(root, file)),
      ])
    surface[owner.name] = {
      exports: byKey(
        entries
          .filter((entry) => entry.owner === owner.name)
          .map(({ key, file }) => [
            key,
            /\.tsx?$/.test(file)
              ? subpathSurface(file)
              : file.endsWith('.css')
                ? stylesheetSurface(file)
                : 'asset',
          ])
      ),
      classes: byKey(classes),
      sources: byKey(sources),
    }
  }
  return surface
}

/** Each path where the live surface differs from the snapshot, as `+ added` or `- removed`. */
export function surfaceDiff(snapshot: unknown, live: unknown, at = ''): string[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (isRecord(snapshot) && isRecord(live)) {
    return sorted(new Set([...Object.keys(snapshot), ...Object.keys(live)])).flatMap((key) => {
      const next = at ? `${at} › ${key}` : key
      if (!(key in live)) return [`- ${next}`]
      if (!(key in snapshot)) return [`+ ${next}`]
      return surfaceDiff(snapshot[key], live[key], next)
    })
  }
  if (Array.isArray(snapshot) && Array.isArray(live)) {
    return [
      ...live.filter((value) => !snapshot.includes(value)).map((value) => `+ ${at} › ${value}`),
      ...snapshot.filter((value) => !live.includes(value)).map((value) => `- ${at} › ${value}`),
    ]
  }
  return JSON.stringify(snapshot) === JSON.stringify(live)
    ? []
    : [`~ ${at}: ${JSON.stringify(snapshot)} → ${JSON.stringify(live)}`]
}

if (import.meta.main) {
  const root = path.resolve(
    process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
      path.resolve(import.meta.dir, '..')
  )
  const live = readSurface(root)
  const snapshotPath = path.join(root, SNAPSHOT)
  if (process.argv.includes('--update')) {
    writeFileSync(snapshotPath, `${JSON.stringify(live, null, 2)}\n`)
    spawnSync(localBin('biome'), ['format', '--write', snapshotPath], { cwd: root })
    process.stdout.write(`Wrote ${SNAPSHOT}\n`)
  } else {
    let snapshot: unknown = {}
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    } catch {}
    const diff = surfaceDiff(snapshot, live)
    if (diff.length) {
      process.stderr.write(
        `EMCN's surface changed (${SNAPSHOT}):\n${diff.map((line) => `  ${line}`).join('\n')}\n\n` +
          'EMCN is frozen: compose the existing components and pass no new attribute, variant, ' +
          'option, item field, parameter, token, selector or class style through to them (a `~` ' +
          'on a class or a stylesheet rule means its declarations changed, and on a source file ' +
          'that its code changed). Only the design owner (CODEOWNERS) changes ' +
          'EMCN and regenerates the snapshot with `bun run check:emcn-surface -- --update`.\n'
      )
      process.exitCode = 1
    } else {
      process.stdout.write(`EMCN surface matches ${SNAPSHOT}.\n`)
    }
  }
}
