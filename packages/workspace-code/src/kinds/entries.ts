/**
 * The shared shape of a kind one root file declares whole (`secrets.ts`, `credentials.ts`): one
 * `export default defineX({ <key>: { … } })` whose every entry is one resource, its fields read,
 * printed and fingerprinted through one field table. The file is the kind's only path, grouped
 * under the file's own name.
 *
 * These files name things whose values never belong in source, so their findings carry a line
 * and column but never a code frame: a value written into the file by mistake is not echoed back.
 */
import { compareStrings } from '@sim/utils/string'
import type { ResourceFingerprint } from '../base'
import {
  canonicalFields,
  type DeclFields,
  printFields,
  readFields,
} from '../declaration/field-table'
import { type FieldReport, fieldPointer, fieldReporter, readObject } from '../declaration/fields'
import { printDeclaration } from '../declaration/print'
import { readDeclaration } from '../declaration/read'
import { diagnostic, resourceOf, type WorkspaceDiagnostic, wholeFile } from '../diagnostics'
import { fingerprintOf } from '../fingerprint'
import { type FileKind, type GroupedPaths, KIND_DIRS, type KindCodec } from '../kind'

/** How one root-file kind reads, prints and fingerprints its entries. */
interface EntryKind<E> {
  kind: FileKind
  /** The function the file default-exports a call of: `defineSecrets`. */
  callee: string
  /** Each entry's fields. */
  fields: DeclFields<E>
  /** Whether `key` may name an entry, else the finding that refuses it. */
  checkKey(key: string, pointer: string, report: FieldReport): boolean
  /** Fields an entry may not hold, with why: reported instead of an unknown field. */
  refused?: Readonly<Record<string, string>>
  /** The entry its read fields make, or `undefined` when a required one is missing. */
  complete(read: Partial<E>): E | undefined
}

/** The key the root file of a kind groups under: its name without the extension (`secrets`). */
export function fileKindGroupKey(kind: FileKind): string {
  return KIND_DIRS[kind].replace(/\.ts$/, '')
}

/** Groups a root-file kind: its file under the file's name. */
function groupRootFile(kind: FileKind, paths: readonly string[]): GroupedPaths {
  const groups = new Map<string, string[]>()
  const diagnostics: WorkspaceDiagnostic[] = []
  for (const path of paths) {
    if (path === KIND_DIRS[kind]) groups.set(fileKindGroupKey(kind), [path])
    else {
      diagnostics.push(
        diagnostic('E_DECL_UNKNOWN_FILE', `${path} belongs to no resource.`, {
          hint: `${KIND_DIRS[kind]} is one file at the root of the directory.`,
          span: wholeFile(path),
        })
      )
    }
  }
  return { groups, diagnostics }
}

/** `finding` without its code frame, so no line of the file is echoed back. */
function withoutFrame(finding: WorkspaceDiagnostic): WorkspaceDiagnostic {
  return { ...finding, frame: undefined }
}

/** The codec of a root-file kind whose declaration is its entries by key. */
export function entryCodec<E>(spec: EntryKind<E>): KindCodec<Record<string, E>> {
  const file = KIND_DIRS[spec.kind]
  return {
    group: (paths) => groupRootFile(spec.kind, paths),
    parse(key, text) {
      const resource = resourceOf(spec.kind, key)
      const source = text[file] ?? ''
      const read = readDeclaration(file, source, { callee: spec.callee })
      const diagnostics: WorkspaceDiagnostic[] = read.diagnostics.map((finding) => ({
        ...finding,
        ...resource,
      }))
      const done = (decl?: Record<string, E>) => ({
        ...(decl ? { decl } : {}),
        diagnostics: diagnostics.map(withoutFrame),
      })
      if (read.value === undefined) return done()
      const report = fieldReporter(source, read.spans, diagnostics, resource)
      const value = readObject(read.value, '', report, `${spec.callee}()`)
      if (!value) return done()
      const entries: Array<[string, E]> = []
      for (const [entryKey, raw] of Object.entries(value)) {
        const pointer = fieldPointer('', entryKey)
        if (!spec.checkKey(entryKey, pointer, report)) continue
        const object = readObject(raw, pointer, report, `"${entryKey}"`)
        if (!object) continue
        let refused = false
        for (const [field, why] of Object.entries(spec.refused ?? {})) {
          if (object[field] === undefined) continue
          report('E_DECL_UNKNOWN_FIELD', fieldPointer(pointer, field), why)
          refused = true
        }
        const known = Object.keys(spec.refused ?? {})
        const entry = spec.complete(readFields(spec.fields, object, pointer, report, known))
        if (!refused && entry !== undefined) entries.push([entryKey, entry])
      }
      if (diagnostics.some((finding) => finding.severity === 'error')) return done()
      // `fromEntries` defines own properties, so an entry named `__proto__` stays an entry.
      return done(Object.fromEntries(entries))
    },
    print(_key, decl) {
      const entries = Object.keys(decl)
        .sort(compareStrings)
        .map((entryKey) => [entryKey, printFields(spec.fields, decl[entryKey])] as const)
      return {
        text: { [file]: printDeclaration(spec.callee, Object.fromEntries(entries)) },
        blobs: [],
      }
    },
    canonical: (decl) =>
      Object.fromEntries(
        Object.keys(decl)
          .sort(compareStrings)
          .map((entryKey) => [entryKey, canonicalFields(spec.fields, decl[entryKey])])
      ),
  }
}

/** The fingerprint of one entry of a root-file kind, as the base records it. */
export function entryFingerprint<E>(fields: DeclFields<E>, entry: E): ResourceFingerprint {
  return fingerprintOf(canonicalFields(fields, entry))
}
