#!/usr/bin/env bun
/**
 * Freezes the public surface of `@sim/emcn` and `@sim/emcn-platform`. The design owner's rule:
 * legacy components stay custom or `emcn-legacy`, new work composes EMCN as it stands, and nothing
 * is added to EMCN, so no attribute, variant or option is passed through to it. The surface is every
 * export subpath, each one's exported names, each exported component's props with their literal
 * variant values, and every CSS Module class in the package. It is recorded in
 * `scripts/emcn-surface.json`; any difference fails. Only the design owner (CODEOWNERS) changes
 * EMCN or regenerates the snapshot with `--update`: compose the existing component instead.
 *
 * Run: `bun run check:emcn-surface` (`-- --update` rewrites the snapshot)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import postcss from 'postcss'
import { emcnPackages, emcnTypeScriptPaths } from './emcn-packages'
import { localBin } from './local-bin'
import { listRepoFiles } from './repo-files'

const FROZEN = new Set(['@sim/emcn', '@sim/emcn-platform'])
export const SNAPSHOT = 'scripts/emcn-surface.json'

/** A prop's literal values, sorted, or `null` when its type is not a literal union. */
type PropShape = string[] | null
interface SubpathSurface {
  names: string[]
  props: Record<string, Record<string, PropShape>>
}
export interface PackageSurface {
  exports: Record<string, SubpathSurface | 'asset'>
  classes: Record<string, string[]>
}
export type Surface = Record<string, PackageSurface>

const sorted = <T>(values: Iterable<T>) => [...values].sort()
const byKey = <T>(entries: [string, T][]) =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

function literalValues(type: ts.Type): PropShape {
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))
  )
  if (!members.length) return null
  const values: string[] = []
  for (const member of members) {
    if (member.isStringLiteral() || member.isNumberLiteral()) values.push(String(member.value))
    else if (member.flags & ts.TypeFlags.BooleanLiteral)
      values.push((member as ts.Type & { intrinsicName: string }).intrinsicName)
    else return null
  }
  return sorted(new Set(values))
}

/** Reads the frozen packages' surface from the tree at `root`. */
export function readSurface(root: string): Surface {
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

  function subpathSurface(file: string): SubpathSurface {
    const source = program.getSourceFile(file)
    const module = source && checker.getSymbolAtLocation(source)
    const names: string[] = []
    const props: SubpathSurface['props'] = {}
    for (const symbol of module ? checker.getExportsOfModule(module) : []) {
      names.push(symbol.name)
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      const declaration = target.valueDeclaration
      if (!declaration || !/^[A-Z]/.test(symbol.name)) continue
      const [signature] = checker.getTypeOfSymbolAtLocation(target, declaration).getCallSignatures()
      const [parameter] = signature?.getParameters() ?? []
      if (!parameter) continue
      const shape = checker.getTypeOfSymbolAtLocation(parameter, declaration)
      const own: Record<string, PropShape> = {}
      const inherited = new Set<string>()
      for (const member of shape.isUnion() ? shape.types : [shape]) {
        for (const prop of checker.getPropertiesOfType(checker.getApparentType(member))) {
          const owner = prop.declarations?.[0]?.parent
          if (!owner?.getSourceFile().fileName.startsWith(packagesRoot)) {
            // DOM and React attributes, recorded by the interface that declares them.
            const name = owner && (ts.isInterfaceDeclaration(owner) ? owner.name.text : undefined)
            inherited.add(name ?? 'anonymous')
            continue
          }
          own[prop.name] = literalValues(
            checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(prop, declaration))
          )
        }
      }
      if (inherited.size) own['…inherited'] = sorted(inherited)
      props[symbol.name] = byKey(Object.entries(own))
    }
    return { names: sorted(names), props: byKey(Object.entries(props)) }
  }

  const surface: Surface = {}
  for (const owner of owners) {
    const prefix = `${path.relative(root, owner.directory)}/`
    const classes = files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.module.css'))
      .map((file): [string, string[]] => {
        const found = new Set<string>()
        postcss.parse(readFileSync(path.join(root, file), 'utf8')).walkRules((rule) => {
          for (const [, name] of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) found.add(name)
        })
        return [file.slice(prefix.length), sorted(found)]
      })
    surface[owner.name] = {
      exports: byKey(
        entries
          .filter((entry) => entry.owner === owner.name)
          .map(({ key, file }) => [key, /\.tsx?$/.test(file) ? subpathSurface(file) : 'asset'])
      ),
      classes: byKey(classes),
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
          'EMCN is frozen: compose the existing components and pass no new attribute, variant or ' +
          'option through to them. Only the design owner (CODEOWNERS) changes EMCN and regenerates ' +
          'the snapshot with `bun run check:emcn-surface -- --update`.\n'
      )
      process.exitCode = 1
    } else {
      process.stdout.write(`EMCN surface matches ${SNAPSHOT}.\n`)
    }
  }
}
