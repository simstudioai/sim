// @ts-nocheck — one-time codemod, run via a scratch `bun add ts-morph` (ts-morph is intentionally
// not a project dependency). Moves each blocks/blocks/<name>.ts `export const <X>BlockMeta = {...}`
// into the existing <name>.display.ts (merging the icon/type imports it references), and removes it
// from <name>.ts. Idempotent: a file whose meta is already gone is skipped.
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { Node, Project } from 'ts-morph'

const APP = process.cwd()
const BLOCK_DIR = path.join(APP, 'blocks/blocks')
const onlyArg = process.argv[2] // optional single-file test, e.g. slack.ts

const project = new Project({
  tsConfigFilePath: path.join(APP, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

function referencedIdents(node: Node): Set<string> {
  const out = new Set<string>()
  node.forEachDescendant((d) => {
    if (Node.isIdentifier(d)) out.add(d.getText())
  })
  return out
}

const results: { file: string; status: string; note?: string }[] = []

const files = readdirSync(BLOCK_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.display.ts'))
  .filter((f) => (onlyArg ? f === onlyArg : true))

for (const file of files) {
  const base = file.replace(/\.ts$/, '')
  const sf = project.addSourceFileAtPath(path.join(BLOCK_DIR, file))
  try {
    // collect exported `<X>BlockMeta` object-literal consts
    const metas: { name: string; stmt: ReturnType<typeof sf.getVariableStatements>[number] }[] = []
    for (const vs of sf.getVariableStatements()) {
      if (!vs.isExported()) continue
      for (const decl of vs.getDeclarations()) {
        if (!decl.getName().endsWith('BlockMeta')) continue
        if (!decl.getInitializer()) continue // value const (incl. `{...} satisfies BlockMeta`)
        metas.push({ name: decl.getName(), stmt: vs })
      }
    }
    if (metas.length === 0) {
      results.push({ file, status: 'skip' })
      project.removeSourceFile(sf)
      continue
    }

    const displayPath = path.join(BLOCK_DIR, `${base}.display.ts`)
    let displaySf
    try {
      displaySf = project.addSourceFileAtPath(displayPath)
    } catch {
      results.push({ file, status: 'ERROR', note: 'no .display.ts to append to' })
      project.removeSourceFile(sf)
      continue
    }

    // identifiers referenced by all metas → resolve to block.ts imports (icons + BlockMeta type).
    // Merge as plain named imports keyed by module (type names work in `satisfies` position).
    const wantByModule = new Map<string, Set<string>>()
    for (const m of metas) {
      for (const id of referencedIdents(m.stmt)) {
        if (id === m.name) continue
        const imp = sf
          .getImportDeclarations()
          .find((d) =>
            d.getNamedImports().some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === id)
          )
        if (!imp) continue
        const mod = imp.getModuleSpecifierValue()
        if (!wantByModule.has(mod)) wantByModule.set(mod, new Set())
        wantByModule.get(mod)!.add(id)
      }
    }

    // merge into .display.ts: extend an existing same-module decl, else create one WITH its names
    for (const [mod, names] of wantByModule) {
      const decl = displaySf
        .getImportDeclarations()
        .find((d) => d.getModuleSpecifierValue() === mod)
      const present = new Set(
        decl?.getNamedImports().map((n) => n.getAliasNode()?.getText() ?? n.getName()) ?? []
      )
      const toAdd = [...names].filter((n) => !present.has(n)).sort()
      if (toAdd.length === 0) continue
      if (decl) decl.addNamedImports(toAdd)
      else displaySf.addImportDeclaration({ moduleSpecifier: mod, namedImports: toAdd })
    }

    // append the meta const(s) to .display.ts, then remove from block.ts
    for (const m of metas) {
      displaySf.addStatements(`\n${m.stmt.getText()}`)
      m.stmt.remove()
    }

    results.push({ file, status: 'ok', note: `${metas.length} meta(s)` })
  } catch (e) {
    results.push({ file, status: 'ERROR', note: String(e).slice(0, 140) })
  }
}

project.saveSync()

const ok = results.filter((r) => r.status === 'ok')
const err = results.filter((r) => r.status === 'ERROR')
console.log(
  `ok=${ok.length} skip=${results.filter((r) => r.status === 'skip').length} err=${err.length}`
)
for (const r of err) console.log(`  ERROR ${r.file} — ${r.note}`)
