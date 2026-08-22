import { getSeededSubBlockValues } from '@/lib/workflows/blocks/canvas-card-fields'
import { getOperationSubBlockId } from '@/lib/workflows/blocks/canvas-sentence'
import { toImperativeLead } from '@/lib/workflows/blocks/canvas-sentence-imperative'
import { resolveFieldNoun, startsWithVowelSound } from '@/lib/workflows/blocks/canvas-sentence-noun'
import { renderSentenceReadings } from '@/lib/workflows/blocks/canvas-sentence-render'
import { resolveTriggerSentence } from '@/lib/workflows/blocks/canvas-trigger-sentence'
import {
  buildCanonicalIndex,
  type CanonicalIndex,
  isCanonicalPair,
  isSubBlockVisibleForMode,
  isToolInputOnlySubBlock,
  isTriggerModeSubBlock,
} from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig, CanvasSentence, SubBlockConfig } from '@/blocks/types'

/**
 * Static validation for declarative canvas sentences.
 *
 * Every failure here is invisible at runtime: a sentence that references a
 * field the block does not have, or that the current operation never shows,
 * simply resolves to nothing. No error is thrown and nothing is logged, so
 * these have to be caught before they ship.
 *
 * These rules are a *model* of `resolveCanvasSentence`, and the two drifting
 * apart is the failure this module keeps re-learning: it once proved a field
 * merely *visible* where the card required a *value*, and later ignored
 * basic/advanced mode entirely, certifying 35 sentences that paint nothing. So
 * visibility here is decided by `getCardSubBlocks` — the same function the
 * canvas filters with — and `check-canvas-sentences.ts` additionally runs the
 * real resolver over every operation rather than trusting this file alone.
 */

/** Config slice a sentence is validated against. */
export type ValidatableBlockConfig = Pick<
  BlockConfig,
  'type' | 'category' | 'canvasPresentation' | 'subBlocks'
>

export interface SentenceFailure {
  /** `default`, or `byOperation.<operationId>`. */
  location: string
  message: string
}

export interface SentenceCoverage {
  covered: number
  total: number
  /** Operation ids (or `default`) with no sentence declared. */
  missing: string[]
}

export interface SentenceValidation {
  failures: SentenceFailure[]
  coverage: SentenceCoverage
}

/**
 * Block types whose card never paints an action sentence.
 *
 * `condition` and `router_v2` paint branch rows instead; `note` is not a block
 * card at all; `starter` is the workflow entry point rather than a step.
 * Counting these as uncovered would make full coverage unreachable, so the
 * finish line could never be asserted.
 *
 * Trigger-*category* blocks are not exempt — they paint a trigger sentence,
 * which `check-canvas-sentences` covers separately. They simply declare no
 * `sentences`, so they contribute no action-mode coverage slots.
 */
const SENTENCE_EXEMPT_TYPES = new Set(['condition', 'router_v2', 'note', 'starter'])

/**
 * Blocks whose trigger card needs no sentence.
 *
 * The workflow's own entry points. Every other trigger names an external event
 * worth reading — "Run on Pull Request Opened" — but these *are* the start of
 * the run, and their header already says so: Start, Chat, Manual. A sentence
 * repeating it would be the "Send a Slack message" mistake in another costume.
 */
export const TRIGGER_SENTENCE_EXEMPT_TYPES = new Set([
  'starter',
  'start_trigger',
  'api_trigger',
  'chat_trigger',
  'input_trigger',
  'manual_trigger',
])

function rendersSentence(config: ValidatableBlockConfig): boolean {
  if (SENTENCE_EXEMPT_TYPES.has(config.type)) return false
  /* A trigger-category block has no action mode, so it declares no action
     sentences and reports no coverage slots — but its trigger card is checked. */
  return config.category !== 'triggers'
}

/**
 * Trailing words that need a value after them to read as a sentence.
 *
 * Copy that survives a dropped clause — a bare string, or a clause's `after` —
 * must not end on one of these, or the card renders
 * `Query rows from ⟨orders⟩, where` with nothing following.
 */
const DANGLING_CONNECTIVES = new Set([
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'setting',
  'to',
  'using',
  'where',
  'with',
])

interface EnumeratedOption {
  id: string
  label: string
}

/** Reads a dropdown's options, tolerating the function-valued form. */
function getOptions(subBlock: SubBlockConfig | undefined): EnumeratedOption[] | null {
  if (!subBlock?.options) return null
  try {
    const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
    if (!Array.isArray(options)) return null
    return options as EnumeratedOption[]
  } catch {
    /* A dropdown whose options need runtime state cannot be enumerated here. */
    return null
  }
}

function getOptionIds(subBlock: SubBlockConfig | undefined): Set<string> | null {
  const options = getOptions(subBlock)
  return options ? new Set(options.map((option) => option.id)) : null
}

/**
 * Whether a clause always renders something.
 *
 * A bare string is literal copy. A `core` clause holds its place with the
 * field's noun — but only where the field is on this operation's card at all,
 * which is why this needs the operation rather than just the clause. Everything
 * else can vanish, taking its own leading connective with it.
 */
function isAlwaysPresent(
  clause: CanvasSentence[number],
  operationId: string | null,
  index: BlockIndex
): boolean {
  if (typeof clause === 'string') return true
  if (clause.core !== true) return false
  return isFieldGuaranteed(toFieldIds(clause.field), operationId, index)
}

/** The last word of a copy fragment, lowercased and stripped of punctuation. */
function lastWord(text: string): string {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/[.,;:]+$/, '')
    .split(/\s+/)
  return words[words.length - 1] ?? ''
}

/** The first word of a copy fragment, lowercased and stripped of punctuation. */
function firstWord(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/^[.,;:]+/, '')
      .trim()
      .split(/\s+/)[0] ?? ''
  )
}

/** The copy a clause renders before its chip, or the whole of a literal clause. */
function leadingCopy(clause: CanvasSentence[number]): string {
  return typeof clause === 'string' ? clause : (clause.text ?? '')
}

/**
 * Two-operand constructions whose second operand must not be droppable.
 *
 * `DANGLING_CONNECTIVES` cannot see these: the opener sits in the clause's own
 * `text`, in front of its own chip, so the chip renders between the two halves
 * and nothing trails. What breaks is the relation, not the grammar — "Route
 * from ⟨origin⟩" is a well-formed sentence that describes a different journey.
 */
const CORRELATIVES = [
  { opener: 'from', closer: 'to' },
  { opener: 'between', closer: 'and' },
] as const

function toFieldIds(field: string | readonly string[]): readonly string[] {
  return typeof field === 'string' ? [field] : field
}

/**
 * Groups subblocks by id.
 *
 * Ids are not unique — a block may declare the same id several times with
 * different conditions (table's `filter` is one variant per operation family),
 * and the card shows whichever matches. Every definition has to be considered.
 */
/**
 * Everything about a block's subblocks that the rules need, resolved once.
 *
 * Built per block rather than per sentence: a block with 87 operations was
 * rebuilding both indexes 87 times over identical input.
 */
interface BlockIndex {
  subBlocks: SubBlockConfig[]
  byId: Map<string, SubBlockConfig[]>
  canonical: CanonicalIndex
  /** What a freshly-created block holds, for canonical-mode resolution. */
  seededValues: Record<string, unknown>
}

function buildBlockIndex(config: ValidatableBlockConfig): BlockIndex {
  return {
    subBlocks: config.subBlocks,
    byId: groupSubBlocksById(config.subBlocks),
    // canonical-index-unscoped: `resolveVisibility` returns `hidden` for every trigger-mode
    // subblock as its first check, so only action subblocks ever reach this index.
    canonical: buildCanonicalIndex(config.subBlocks),
    seededValues: getSeededSubBlockValues(config),
  }
}

function groupSubBlocksById(subBlocks: SubBlockConfig[]): Map<string, SubBlockConfig[]> {
  const byId = new Map<string, SubBlockConfig[]>()
  for (const subBlock of subBlocks) {
    const existing = byId.get(subBlock.id)
    if (existing) existing.push(subBlock)
    else byId.set(subBlock.id, [subBlock])
  }
  return byId
}

type Visibility = 'visible' | 'hidden' | 'unknown'

/** A `condition` this module can reason about — the object form, not a function. */
type StaticCondition = {
  field: string
  value: unknown
  not?: boolean
  and?: { field: string; value: unknown; not?: boolean }
}

/**
 * A subblock's condition, with the function form resolved for one operation.
 *
 * A `condition` function is a pure function of the block's values, and the card
 * simply calls it (`evaluateSubBlockCondition`). Calling it here with the
 * operation under test is what lets this module agree with the card instead of
 * declaring every function-gated field undecidable — the shape is nearly always
 * a switch on `operation` that returns a plain condition, as in Slack's
 * `channel`. Returns `undefined` for "no gate" and `'unknown'` where the result
 * still turns on a value only the user can supply.
 */
function resolveCondition(
  subBlock: SubBlockConfig,
  operationId: string | null
): StaticCondition | undefined | 'unknown' {
  const { condition } = subBlock
  if (!condition) return undefined
  if (typeof condition !== 'function') return condition as StaticCondition

  try {
    const resolved = condition(operationId === null ? {} : { operation: operationId })
    return (resolved as StaticCondition | undefined) ?? undefined
  } catch {
    /* A condition needing values beyond the operation cannot be decided here. */
    return 'unknown'
  }
}

/** One `field`/`value` test; a condition is one of these plus an optional `and`. */
type ConditionClause = { field: string; value: unknown; not?: boolean }

function conditionClauses(gate: StaticCondition): ConditionClause[] {
  return gate.and ? [gate, gate.and] : [gate]
}

function clauseHolds(clause: ConditionClause, actual: string): boolean {
  const allowed = new Set((Array.isArray(clause.value) ? clause.value : [clause.value]).map(String))
  const matches = allowed.has(actual)
  return clause.not ? !matches : matches
}

/**
 * What is left of a subblock's gate once the operation is known.
 *
 * `visible` and `hidden` are settled. `conditional` is the interesting one: the
 * operation half passed, and what remains turns on another dropdown — Slack's
 * `channel` shows for `send` only while `destinationType` is not `dm`. Keeping
 * that residue rather than collapsing it to "undecidable" is what lets a pair
 * of fields covering both sides of that dropdown prove the slot always renders.
 */
type OperationVisibility =
  | { kind: 'visible' }
  | { kind: 'hidden' }
  | { kind: 'unknown' }
  | { kind: 'conditional'; on: ConditionClause }

function resolveVisibility(
  subBlock: SubBlockConfig,
  operationId: string | null,
  index: BlockIndex,
  advanced: boolean
): OperationVisibility {
  if (isTriggerModeSubBlock(subBlock)) return { kind: 'hidden' }
  if (subBlock.hidden || subBlock.hideFromPreview) return { kind: 'hidden' }
  if (isToolInputOnlySubBlock(subBlock)) return { kind: 'hidden' }

  /* Whether these show turns on the deployment, not on the block, so nothing
     here can prove a card will have them. */
  if (subBlock.showWhenEnvSet || subBlock.hideWhenHosted || subBlock.hideWhenEnvSet) {
    return { kind: 'unknown' }
  }

  /*
   * Mode is the axis the card applies and this module used to ignore, which let
   * 35 sentences anchor on an advanced-only field and paint nothing on a fresh
   * card. `advanced` is the view being asked about: the guarantee asks about the
   * basic view a user lands on, while the dead-clause rule asks whether a field
   * can show in *either* view before calling it dead config.
   */
  const canonicalId = index.canonical.canonicalIdBySubBlockId[subBlock.id]
  const group = canonicalId ? index.canonical.groupsById[canonicalId] : undefined

  if (group && isCanonicalPair(group)) {
    /* Which member of a pair shows turns on whether the user filled the advanced
       field, not on the block-level toggle — so neither member is ever dead, and
       only the basic one is on the card a user first sees. Naming both is already
       required by the canonical-pair rule below. */
    if (!advanced && group.basicId !== subBlock.id) return { kind: 'hidden' }
  } else if (
    !isSubBlockVisibleForMode(subBlock, advanced, index.canonical, index.seededValues, undefined)
  ) {
    return { kind: 'hidden' }
  }

  const gate = resolveCondition(subBlock, operationId)
  if (gate === undefined) return { kind: 'visible' }
  if (gate === 'unknown') return { kind: 'unknown' }

  const clauses = conditionClauses(gate)
  const onOperation = clauses.filter((clause) => clause.field === 'operation')
  const residual = clauses.filter((clause) => clause.field !== 'operation')

  /* Without an operation dropdown a gate on `operation` is meaningless. */
  if (operationId === null && onOperation.length > 0) return { kind: 'unknown' }
  if (onOperation.some((clause) => !clauseHolds(clause, operationId as string))) {
    return { kind: 'hidden' }
  }

  if (residual.length === 0) return { kind: 'visible' }
  /* Two independent residual axes would need a cross-product proof. */
  if (residual.length > 1) return { kind: 'unknown' }

  return { kind: 'conditional', on: residual[0] }
}

/**
 * Whether one subblock definition can show for the given operation.
 *
 * Trigger-mode definitions never count. A dual-mode block spreads its trigger's
 * subblocks after its own, and those re-declare ids like `tableId` with
 * `mode: 'trigger'` and no `condition` — which would otherwise read as
 * "visible for every operation" and mask a genuinely dead clause. Cards in
 * trigger mode render no sentence at all, so the trigger copy is irrelevant here.
 */
function visibilityForOperation(
  subBlock: SubBlockConfig,
  operationId: string,
  index: BlockIndex
): Visibility {
  /* Dead config means no view shows it. A `mode: 'advanced'` field is not dead —
     it is one toggle away — so both views are asked before condemning a clause. */
  for (const advanced of [false, true]) {
    const resolved = resolveVisibility(subBlock, operationId, index, advanced)
    if (resolved.kind !== 'hidden')
      return resolved.kind === 'conditional' ? 'unknown' : resolved.kind
  }
  return 'hidden'
}

/**
 * Whether a clause's field is guaranteed to be on the card for this operation.
 *
 * Two shapes prove it. A definition this operation shows outright is always
 * there. Failing that, a set of definitions whose *residual* conditions
 * exhaustively partition a single dropdown is also total: `file` names both
 * `file` (`inputMethod: upload`) and `filePath` (`inputMethod: url`), and Slack's
 * destination names both the channel pair and the DM pair across
 * `destinationType`. Exactly one of each set is showing at any moment.
 *
 * A condition that still turns on a value only the user can supply stays
 * undecidable, and an anchor behind one is rejected rather than assumed.
 */
function isFieldGuaranteed(
  fieldIds: readonly string[],
  operationId: string | null,
  index: BlockIndex
): boolean {
  const definitions = fieldIds.flatMap((fieldId) => index.byId.get(fieldId) ?? [])
  if (definitions.length === 0) return false

  const resolved = definitions.map((definition) =>
    resolveVisibility(definition, operationId, index, false)
  )
  if (resolved.some((entry) => entry.kind === 'visible')) return true

  /* Only the definitions still in play can contribute to a partition; a hidden
     one is out, and an undecidable one can never complete a cover. */
  if (resolved.some((entry) => entry.kind === 'unknown')) return false
  const gates = resolved.flatMap((entry) => (entry.kind === 'conditional' ? [entry.on] : []))
  if (gates.length === 0) return false

  const gateField = gates[0].field
  if (!gates.every((gate) => gate.field === gateField)) return false

  const options = getOptionIds(index.subBlocks.find((subBlock) => subBlock.id === gateField))
  if (!options) return false

  const covered = new Set<string>()
  for (const gate of gates) {
    const values = (Array.isArray(gate.value) ? gate.value : [gate.value]).map(String)
    if (gate.not) {
      for (const option of options) if (!values.includes(option)) covered.add(option)
    } else {
      for (const value of values) covered.add(value)
    }
  }
  return [...options].every((option) => covered.has(option))
}

/**
 * A card names an action, so its sentence opens with a command — the same voice
 * as the operation title in the heading directly above it ("Send Email" over
 * "Send ⟨a subject⟩ to ⟨a recipient⟩"). Third person describes the block to a
 * reader instead, and the two mixed across a canvas read as two authors.
 *
 * Split out from the rules below because it is the only one that holds for a
 * trigger card too: it reads the copy alone, with no claim about which fields
 * are present.
 *
 * Scoped to the *leading* verb. A second verb coordinated later in the sentence
 * ("Create or update record ⟨id⟩") is left to review: `and`/`or` joins nouns far
 * more often than verbs here — "List collections and indexes", "List filings and
 * reports" — and no rule separates the two without flagging those, which would
 * cost more trust than the case is worth.
 */
function checkImperativeVoice(
  sentence: CanvasSentence,
  location: string,
  failures: SentenceFailure[]
): void {
  const lead = sentence[0] === undefined ? '' : leadingCopy(sentence[0])
  const imperative = toImperativeLead(lead)
  if (imperative === lead) return
  failures.push({
    location,
    message:
      `sentence opens "${lead}" in the third person — write "${imperative}". A card names ` +
      'an action, in the same voice as the operation title in its heading.',
  })
}

/**
 * The voice rule over the sentence a trigger card actually paints.
 *
 * Trigger sentences do not go through `checkSentence`: its `core` rules prove a
 * field is on the *action* card, and trigger mode swaps the subblock set
 * wholesale, so they would report against a card that does not exist. Voice is
 * the one rule that survives that difference, and it has to run on the
 * *resolved* sentence rather than the declaration — most trigger copy is
 * derived from the trigger's registry name, never authored in a block file.
 */
export function validateTriggerSentence(
  config: ValidatableBlockConfig & Pick<BlockConfig, 'triggers'>,
  triggerId: string | null,
  triggerName: string | null
): SentenceFailure[] {
  const sentence = resolveTriggerSentence(config, triggerId, triggerName)
  if (!sentence) return []
  const failures: SentenceFailure[] = []
  checkImperativeVoice(sentence, `trigger.${triggerId ?? 'default'}`, failures)
  return failures
}

function checkSentence(
  sentence: CanvasSentence,
  location: string,
  operationId: string | null,
  blockIndex: BlockIndex,
  failures: SentenceFailure[]
): void {
  const fail = (message: string) => failures.push({ location, message })

  const subBlocksById = blockIndex.byId
  const canonicalIndex = blockIndex.canonical

  const survives = (clause: CanvasSentence[number]) =>
    isAlwaysPresent(clause, operationId, blockIndex)

  checkImperativeVoice(sentence, location, failures)

  sentence.forEach((clause, index) => {
    const nextClause = sentence[index + 1]

    /*
     * The clause's last rendered word: its `after`, or the whole string for a
     * literal clause. It has to survive the next clause dropping.
     */
    const trailingCopy = typeof clause === 'string' ? [clause] : [clause.after].filter(Boolean)

    for (const copy of trailingCopy as string[]) {
      const word = lastWord(copy)
      if (!DANGLING_CONNECTIVES.has(word)) continue

      if (nextClause === undefined) {
        fail(`clause ${index} ends on "${word}" with nothing after it.`)
      } else if (!survives(nextClause)) {
        fail(
          `clause ${index} ends on "${word}", but clause ${index + 1} is optional — ` +
            `move that word into clause ${index + 1}'s \`text\` so it drops with the value.`
        )
      }
    }

    /*
     * A clause that opens `from …`/`between …` in front of its own chip needs
     * the clause carrying the second operand to survive an empty card, or the
     * relation renders half-stated.
     */
    const correlative = CORRELATIVES.find(({ opener }) => opener === lastWord(leadingCopy(clause)))
    if (correlative) {
      const closerIndex = sentence.findIndex(
        (later, laterIndex) =>
          laterIndex > index && firstWord(leadingCopy(later)) === correlative.closer
      )
      if (closerIndex !== -1 && !survives(sentence[closerIndex])) {
        fail(
          `clause ${index} opens "${correlative.opener} … ${correlative.closer}", but clause ` +
            `${closerIndex} carries the other half and can drop — the card would state half ` +
            "a relation. Mark that clause `core` so it holds its place with the field's noun."
        )
      }
    }

    if (typeof clause === 'string') return

    const fieldIds = toFieldIds(clause.field)
    if (fieldIds.length === 0) {
      fail(`clause ${index} declares an empty \`field\`.`)
      return
    }

    for (const fieldId of fieldIds) {
      const definitions = subBlocksById.get(fieldId)
      if (!definitions) {
        fail(`clause ${index} references "${fieldId}", which is not a subblock on this block.`)
        continue
      }

      /* A clause under `byOperation.X` naming a field X never shows is dead
         config. Only decidable when every definition of the id is statically
         gated on the operation — one undecidable variant means it may show. */
      if (!operationId) continue
      const verdicts = definitions.map((subBlock) =>
        visibilityForOperation(subBlock, operationId, blockIndex)
      )
      if (verdicts.every((verdict) => verdict === 'hidden')) {
        fail(
          `clause ${index} references "${fieldId}", which is never visible for operation ` +
            `"${operationId}" — its condition gates it to other operations.`
        )
      }
    }

    /*
     * Copy ending in an article in front of a chip is agreeing with a value the
     * author cannot see. Two ways that breaks, and which one applies depends on
     * whether the clause is core.
     */
    const previousClause = index > 0 ? sentence[index - 1] : undefined
    const copyBeforeChip =
      clause.text ??
      (typeof previousClause === 'string' ? previousClause : (previousClause?.after ?? ''))
    const article = /\b(an?|the)$/i.exec(copyBeforeChip.trim())?.[1]?.toLowerCase()

    if (article) {
      if (clause.core === true) {
        /* A core chip shows the field's noun while empty, and a noun carries its
           own article — so the card reads "Add a a reaction". */
        const noun = resolveFieldNoun(subBlocksById.get(fieldIds[0])?.[0] ?? { title: '' })
        fail(
          `clause ${index} ends its copy on "${article}", but the "${fieldIds[0]}" chip is ` +
            `core and supplies its own article — an empty card would read ` +
            `"…${article} ${noun}". Drop the "${article}".`
        )
      } else if (article !== 'the') {
        for (const fieldId of fieldIds) {
          const options = (subBlocksById.get(fieldId) ?? [])
            .map(getOptions)
            .find((candidate): candidate is EnumeratedOption[] => candidate !== null)
          if (!options) continue

          const disagreeing = options.filter(
            (option) => startsWithVowelSound(option.label) !== (article === 'an')
          )
          if (disagreeing.length === 0) continue

          fail(
            `clause ${index} puts "${article}" in front of the "${fieldId}" chip, but its label ` +
              `${disagreeing.map((option) => `"${option.label}"`).join(', ')} needs ` +
              `"${article === 'an' ? 'a' : 'an'}". Move the value out from behind the article.`
          )
        }
      }
    }

    /* An advanced-mode user has only the advanced member of a canonical pair
       filled, so naming one member silently drops the sentence for them. The
       pair cannot be derived from the canonical id — three naming conventions
       are in use across the fleet. */
    const named = new Set(fieldIds)
    for (const fieldId of fieldIds) {
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[fieldId]
      if (!canonicalId) continue
      const group = canonicalIndex.groupsById[canonicalId]
      if (!isCanonicalPair(group)) continue

      const members = [group.basicId, ...group.advancedIds].filter(Boolean) as string[]
      const missing = members.filter((member) => !named.has(member))
      if (missing.length > 0) {
        fail(
          `clause ${index} names "${fieldId}" but omits ` +
            `${missing.map((member) => `"${member}"`).join(', ')} from canonical group ` +
            `"${canonicalId}". List every member: field: [${members.map((m) => `'${m}'`).join(', ')}].`
        )
      }
    }
  })

  /*
   * `core` is a promise that the clause always renders. A clause whose field
   * this operation never shows cannot keep it — there is no replacement copy in
   * this DSL, so the clause simply drops and the promise was silently false.
   */
  sentence.forEach((clause, index) => {
    if (typeof clause === 'string' || clause.core !== true) return
    const fieldIds = toFieldIds(clause.field)
    if (fieldIds.length === 0) return
    if (isFieldGuaranteed(fieldIds, operationId, blockIndex)) return

    fail(
      `clause ${index} is \`core\`, but "${fieldIds[0]}" is not proven to be on the card for ` +
        'this operation, so the clause can still drop. Anchor on a field the operation always ' +
        'shows, or drop `core` and let literal copy carry the sentence.'
    )
  })

  /*
   * A sentence that can resolve to nothing paints a card with no summary and no
   * rows worth reading. At least one clause has to survive an untouched card:
   * literal copy always does, and a `core` clause does once its field is proven
   * to be on the card.
   */
  const guaranteed = sentence.some(survives)

  if (!guaranteed) {
    fail(
      'nothing in this sentence is guaranteed to render, so an untouched card would paint ' +
        'empty. Add literal copy, or mark a clause `core` whose field this operation always ' +
        'shows.'
    )
  }
}

/**
 * Groups operations whose cards read the same, given one reading per operation.
 *
 * Two operations that paint the same card mean a copy-pasted clause was never
 * adjusted — `get_thread` and `get_thread_replies` both reading "Read thread
 * ⟨id⟩" leaves the user unable to tell which one the block is running.
 */
function groupByReading(readings: Array<[string, string]>): string[][] {
  const byReading = new Map<string, string[]>()
  for (const [operationId, reading] of readings) {
    const sharing = byReading.get(reading)
    if (sharing) sharing.push(operationId)
    else byReading.set(reading, [operationId])
  }
  return [...byReading.values()].filter((sharing) => sharing.length > 1)
}

/**
 * Validates every sentence a block declares, and reports operation coverage.
 *
 * Coverage counts a block with a `default` sentence as covering every
 * operation — the default is the fallback for any operation without its own
 * entry, so declaring one is a deliberate "this phrasing fits them all".
 *
 * A block whose card never paints a sentence reports no coverage slots at all,
 * so it neither helps nor blocks the fleet-wide total.
 */
export function validateBlockSentences(config: ValidatableBlockConfig): SentenceValidation {
  const failures: SentenceFailure[] = []

  if (!rendersSentence(config)) {
    return { failures, coverage: { covered: 0, total: 0, missing: [] } }
  }

  const operationSubBlockId = getOperationSubBlockId(config)
  const operationSubBlock = operationSubBlockId
    ? config.subBlocks.find((subBlock) => subBlock.id === operationSubBlockId)
    : undefined
  const optionIds = getOptionIds(operationSubBlock)
  const sentences = config.canvasPresentation?.sentences

  const index = buildBlockIndex(config)

  if (sentences?.default) {
    checkSentence(sentences.default, 'default', null, index, failures)
  }

  const filledReadings: Array<[string, string]> = []
  const bareReadings: Array<[string, string]> = []

  for (const [operationId, sentence] of Object.entries(sentences?.byOperation ?? {})) {
    const { filled, bare } = renderSentenceReadings(config, operationSubBlockId, {
      mode: 'action',
      operationValue: operationId,
    })
    filledReadings.push([operationId, filled])
    bareReadings.push([operationId, bare])

    /* A key matching no option falls through to `default ?? null` at runtime,
       so the card paints nothing at all. */
    if (optionIds && !optionIds.has(operationId)) {
      failures.push({
        location: `byOperation.${operationId}`,
        message: `no option with id "${operationId}" on the "${operationSubBlockId}" dropdown.`,
      })
    }
    checkSentence(sentence, `byOperation.${operationId}`, operationId, index, failures)
  }

  const others = (sharing: string[]) =>
    sharing
      .slice(1)
      .map((id) => `"${id}"`)
      .join(', ')
  const reported = new Set<string>()

  for (const sharing of groupByReading(filledReadings)) {
    reported.add(sharing.join('␟'))
    failures.push({
      location: `byOperation.${sharing[0]}`,
      message:
        `renders identically to ${others(sharing)}. ` +
        'Each operation needs prose a user can tell apart.',
    })
  }

  /*
   * An optional clause is the whole difference between two operations only
   * while it is filled. Until then both cards read the same, which is the
   * state a user is in when they are still deciding what the block does.
   */
  for (const sharing of groupByReading(bareReadings)) {
    if (reported.has(sharing.join('␟'))) continue
    failures.push({
      location: `byOperation.${sharing[0]}`,
      message:
        `renders identically to ${others(sharing)} once optional clauses are empty. ` +
        'Mark a clause `core` in one of them so the card names what it acts on.',
    })
  }

  if (!optionIds) {
    const covered = sentences?.default ? 1 : 0
    return { failures, coverage: { covered, total: 1, missing: covered ? [] : ['default'] } }
  }

  if (sentences?.default) {
    return { failures, coverage: { covered: optionIds.size, total: optionIds.size, missing: [] } }
  }

  const byOperation = sentences?.byOperation ?? {}
  const missing = [...optionIds].filter((optionId) => !Object.hasOwn(byOperation, optionId))
  return {
    failures,
    coverage: { covered: optionIds.size - missing.length, total: optionIds.size, missing },
  }
}
