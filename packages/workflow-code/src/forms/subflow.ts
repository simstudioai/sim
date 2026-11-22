/**
 * The loop and parallel config forms, `loop.<type>(name, config, body)` and
 * `parallel[.<type>](...)`: which config keys each container type takes, the {@link LoopSpec} or
 * {@link ParallelSpec} field each one fills, how its value is written, and what the executor reads
 * for it. The printer, the compiler and the executable view all walk these tables, and each table
 * is total over its container's types, so a new loop or parallel type fails to type-check here
 * until its form is stated.
 */

import {
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_PARALLEL_COUNT,
  effectiveBatchSize,
} from '../canonicalize/subflows'
import type { Json, LoopSpec, LoopType, ParallelSpec, ParallelType } from '../model'

/** A spec's config fields: everything but its kind and type. */
export type ConfigField<S> = Exclude<keyof S, 'kind' | 'loopType' | 'parallelType'>

/**
 * How a config value is written: a number literal, text (a condition, printed and compiled as
 * `js`), or any JSON value (a collection). Derived from the spec field's type, so an entry cannot
 * pair a field with the wrong kind.
 */
type ConfigKind<T> = [T] extends [number] ? 'number' : [T] extends [string] ? 'text' : 'json'

/** One config key of a container form: the spec field it fills and how it is read and written. */
type ConfigEntry<S> = {
  [F in ConfigField<S>]-?: {
    field: F
    kind: ConfigKind<NonNullable<S[F]>>
    /** Whether the type prints and runs the field for this spec; always when absent. */
    printedWhen?: (spec: S) => boolean
    /**
     * Why the executor does not read the field when `printedWhen` is false, and how to write what
     * runs instead: the `W_FIELD_NOT_APPLICABLE` a source that writes it anyway gets.
     */
    unread?: { reason: string; hint: string }
    /** The value the executor reads for the field (its fallback for an absent or falsy one). */
    runs: (spec: S) => Json
  }
}[ConfigField<S>]

/** A container type's config keys, in print order. */
export type ContainerForm<S> = Readonly<Record<string, ConfigEntry<S>>>

/**
 * The parallel type the executor runs when storage has none: the loader reads a missing
 * `parallelType` as `count` (`loadWorkflowFromNormalizedTablesRaw`).
 */
export const LOADER_PARALLEL_TYPE: ParallelType = 'count'

const LOOP_COUNT: ConfigEntry<LoopSpec> = {
  field: 'iterations',
  kind: 'number',
  runs: (spec) => spec.iterations || DEFAULT_LOOP_ITERATIONS,
}

const LOOP_FORMS: Record<LoopType, ContainerForm<LoopSpec>> = {
  for: { count: LOOP_COUNT },
  forEach: {
    collection: { field: 'forEachItems', kind: 'json', runs: (spec) => spec.forEachItems || '' },
  },
  while: {
    condition: { field: 'whileCondition', kind: 'text', runs: (spec) => spec.whileCondition || '' },
  },
  doWhile: {
    // Without a condition the do-while runs as a count loop.
    count: {
      ...LOOP_COUNT,
      printedWhen: (spec) => !spec.doWhileCondition,
      unread: {
        reason: 'a do-while with a condition runs until the condition is false',
        hint: 'Remove count, or remove condition to run count times.',
      },
    },
    condition: {
      field: 'doWhileCondition',
      kind: 'text',
      runs: (spec) => spec.doWhileCondition || '',
    },
  },
}

const PARALLEL_COUNT: ConfigEntry<ParallelSpec> = {
  field: 'count',
  kind: 'number',
  runs: (spec) => spec.count || DEFAULT_PARALLEL_COUNT,
}
const PARALLEL_COLLECTION: ConfigEntry<ParallelSpec> = {
  field: 'distribution',
  kind: 'json',
  runs: (spec) => spec.distribution || '',
}
const PARALLEL_BATCH_SIZE: ConfigEntry<ParallelSpec> = {
  field: 'batchSize',
  kind: 'number',
  runs: (spec) => effectiveBatchSize(spec.batchSize),
}

const PARALLEL_FORMS: Record<ParallelType, ContainerForm<ParallelSpec>> = {
  count: { count: PARALLEL_COUNT, batchSize: PARALLEL_BATCH_SIZE },
  collection: { collection: PARALLEL_COLLECTION, batchSize: PARALLEL_BATCH_SIZE },
}

/** The bare `parallel(...)` form, which leaves `parallelType` unset and so carries both fields. */
const UNTYPED_PARALLEL_FORM: ContainerForm<ParallelSpec> = {
  count: PARALLEL_COUNT,
  collection: PARALLEL_COLLECTION,
  batchSize: PARALLEL_BATCH_SIZE,
}

/** The form of `loop.<type>`. */
export function loopForm(type: LoopType): ContainerForm<LoopSpec> {
  return LOOP_FORMS[type]
}

/** The form of `parallel.<type>`, or of the bare `parallel(...)` for `null`. */
export function parallelForm(type: ParallelType | null): ContainerForm<ParallelSpec> {
  return type === null ? UNTYPED_PARALLEL_FORM : PARALLEL_FORMS[type]
}

/** One config key of a spec, resolved against its form. */
interface ConfigItem {
  key: string
  kind: 'number' | 'text' | 'json'
  /** The spec's value for the key's field, as stored. */
  value: Json | undefined
  /** Whether the form prints the key for this spec (a printed key may still have no value). */
  printed: boolean
}

function configItems<S>(
  form: ContainerForm<S>,
  spec: S,
  read: (entry: ConfigEntry<S>) => Json | undefined
): ConfigItem[] {
  return Object.entries(form).map(([key, entry]) => ({
    key,
    kind: entry.kind,
    value: read(entry),
    printed: entry.printedWhen?.(spec) ?? true,
  }))
}

/** A spec's config keys as its printed form writes them, in order. */
export function printedConfig(spec: LoopSpec | ParallelSpec): ConfigItem[] {
  return spec.kind === 'loop'
    ? configItems(loopForm(spec.loopType), spec, (entry) => spec[entry.field])
    : configItems(parallelForm(spec.parallelType ?? null), spec, (entry) => spec[entry.field])
}

function runningFields<S>(form: ContainerForm<S>, spec: S): Map<ConfigField<S>, Json> {
  const fields = new Map<ConfigField<S>, Json>()
  for (const entry of Object.values(form)) {
    if (entry.printedWhen?.(spec) ?? true) fields.set(entry.field, entry.runs(spec))
  }
  return fields
}

/**
 * The fields the executor reads for a spec's type, each as it reads it, keyed by spec field. An
 * untyped parallel runs as {@link LOADER_PARALLEL_TYPE}.
 */
export function runningConfig(spec: LoopSpec | ParallelSpec): Record<string, Json> {
  const fields =
    spec.kind === 'loop'
      ? runningFields(loopForm(spec.loopType), spec)
      : runningFields(parallelForm(spec.parallelType ?? LOADER_PARALLEL_TYPE), spec)
  return Object.fromEntries(fields)
}
