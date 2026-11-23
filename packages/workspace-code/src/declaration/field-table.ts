/**
 * A declaration's fields as one table: for each field, how it is read from the declaration
 * object, how it prints, and what it adds to the fingerprint. A kind's reader, printer and
 * `canonical` all walk the same table, and the table is typed over every field of the declaration,
 * so a field cannot be read but not printed, or printed but left out of the fingerprint (where an
 * edit to it would fingerprint equal to the base and be dropped as a no-op).
 */
import type { Json } from '@sim/workflow-code'
import {
  checkKnownFields,
  type FieldReport,
  fieldPointer,
  readBooleanField,
  readFolderField,
  readObject,
  readStringField,
  type StringFieldOptions,
} from './fields'

/**
 * What a field adds to the canonical declaration, given its declared value (`undefined` when not
 * declared). `undefined` leaves the field out, as the fingerprint's stable JSON drops it.
 */
type CanonicalRule<V> = (value: V | undefined) => Json | undefined

/** How one field of a declaration reads, prints and fingerprints. */
export interface DeclField<V> {
  /** Reads `value[field]`, reporting a refused value; `undefined` when absent or refused. */
  read(
    value: Record<string, Json>,
    field: string,
    pointer: string,
    report: FieldReport
  ): V | undefined
  /** The field as printed; `undefined` leaves it out. */
  print(value: V | undefined): Json | undefined
  /**
   * The field's part of the fingerprint, or `null` for a field deliberately outside it (one that
   * never changes once set, say), so leaving a field out is always a stated choice.
   */
  canonical: CanonicalRule<V> | null
}

/**
 * One {@link DeclField} for every field of `D`, in print order. The field helpers type their value
 * as possibly absent (`DeclField<string | undefined>`), which fits a required field and an
 * optional one alike.
 */
export type DeclFields<D> = { readonly [K in keyof D]-?: DeclField<D[K] | undefined> }

/**
 * Reads every field of `fields` from `value` (the object at `pointer`), first reporting each field
 * `value` holds that neither the table nor `alsoKnown` (fields the caller reads itself) names. A
 * field absent or refused is left out.
 */
export function readFields<D>(
  fields: DeclFields<D>,
  value: Record<string, Json>,
  pointer: string,
  report: FieldReport,
  alsoKnown: readonly string[] = []
): Partial<D> {
  checkKnownFields(value, [...Object.keys(fields), ...alsoKnown], pointer, report)
  const read: Partial<D> = {}
  for (const field in fields) {
    const fieldValue = fields[field].read(value, field, pointer, report)
    if (fieldValue !== undefined) read[field] = fieldValue
  }
  return read
}

/** `decl` as printed, its fields in table order. */
export function printFields<D>(fields: DeclFields<D>, decl: Partial<D>): Record<string, Json> {
  const printed: Record<string, Json> = {}
  for (const field in fields) {
    const value = fields[field].print(decl[field])
    if (value !== undefined) printed[field] = value
  }
  return printed
}

/** The canonical JSON of `decl`: each field by its rule, those without one left out. */
export function canonicalFields<D>(fields: DeclFields<D>, decl: Partial<D>): Record<string, Json> {
  const canonical: Record<string, Json> = {}
  for (const field in fields) {
    const value = fields[field].canonical?.(decl[field])
    if (value !== undefined) canonical[field] = value
  }
  return canonical
}

/** A field printed, or fingerprinted, exactly as declared. */
export function asDeclared<V extends Json>(value: V | undefined): V | undefined {
  return value
}

/** A string field, printed as declared and fingerprinted by `canonical` (as declared by default). */
export function stringField(
  options: StringFieldOptions = {},
  canonical: CanonicalRule<string | undefined> | null = asDeclared
): DeclField<string | undefined> {
  return {
    read: (value, field, pointer, report) =>
      readStringField(value, field, pointer, report, options),
    print: asDeclared,
    canonical,
  }
}

/** A boolean field, printed as declared and fingerprinted by `canonical` (as declared by default). */
export function booleanField(
  canonical: CanonicalRule<boolean | undefined> | null = asDeclared
): DeclField<boolean | undefined> {
  return { read: readBooleanField, print: asDeclared, canonical }
}

/**
 * A resource's `folder`: a path from the workspace root (`example`, say), printed as declared and
 * fingerprinted as the root when not declared.
 */
export function folderField(example: string): DeclField<string | undefined> {
  return {
    read: (value, _field, _pointer, report) => readFolderField(value, report, example),
    print: asDeclared,
    canonical: (folder) => folder ?? '/',
  }
}

/**
 * A field holding an object of `fields`, read, printed and (by `canonical`) fingerprinted through
 * that table.
 */
export function objectField<D>(
  fields: DeclFields<D>,
  canonical: CanonicalRule<Partial<D> | undefined>
): DeclField<Partial<D> | undefined> {
  return {
    read(value, field, pointer, report) {
      if (value[field] === undefined) return undefined
      const at = fieldPointer(pointer, field)
      const object = readObject(value[field], at, report, field)
      return object && readFields(fields, object, at, report)
    },
    print: (value) => (value === undefined ? undefined : printFields(fields, value)),
    canonical,
  }
}
