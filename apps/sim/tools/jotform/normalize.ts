import type {
  JotformFile,
  JotformForm,
  JotformLabel,
  JotformLabelNode,
  JotformLabelResource,
  JotformQuestion,
  JotformReport,
  JotformSubmission,
  JotformSubmissionAnswer,
  JotformSubUser,
  JotformUser,
} from '@/tools/jotform/types'
import { isRecord, toJsonArray, toStringOrNull } from '@/tools/jotform/utils'

/**
 * Jotform returns every scalar as a string and documents `content` as either an
 * object or a single-element array depending on the endpoint, so each resource is
 * projected through one normalizer rather than mapped inline per tool.
 */

/** Unwraps the single-element array form some endpoints document for one resource. */
export function unwrapSingle(content: unknown): Record<string, unknown> | null {
  if (Array.isArray(content)) return isRecord(content[0]) ? content[0] : null
  return isRecord(content) ? content : null
}

export function toList(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.filter(isRecord)
  /* Folder `forms` and question maps come back keyed by id rather than as arrays. */
  if (isRecord(content)) return Object.values(content).filter(isRecord)
  return []
}

export function normalizeForm(raw: Record<string, unknown>): JotformForm {
  return {
    id: toStringOrNull(raw.id),
    username: toStringOrNull(raw.username),
    title: toStringOrNull(raw.title),
    height: toStringOrNull(raw.height),
    status: toStringOrNull(raw.status),
    created_at: toStringOrNull(raw.created_at),
    updated_at: toStringOrNull(raw.updated_at),
    last_submission: toStringOrNull(raw.last_submission),
    new: toStringOrNull(raw.new),
    count: toStringOrNull(raw.count),
    type: toStringOrNull(raw.type),
    favorite: toStringOrNull(raw.favorite),
    archived: toStringOrNull(raw.archived),
    url: toStringOrNull(raw.url),
  }
}

export function normalizeQuestion(raw: Record<string, unknown>): JotformQuestion {
  return {
    ...raw,
    qid: toStringOrNull(raw.qid),
    name: toStringOrNull(raw.name),
    order: toStringOrNull(raw.order),
    text: toStringOrNull(raw.text),
    type: toStringOrNull(raw.type),
    required: toStringOrNull(raw.required),
  }
}

function normalizeAnswer(raw: Record<string, unknown>): JotformSubmissionAnswer {
  return {
    text: toStringOrNull(raw.text),
    type: toStringOrNull(raw.type),
    answer: raw.answer ?? null,
    prettyFormat: toStringOrNull(raw.prettyFormat),
  }
}

/** Renders one answer as the single string `values` holds. */
function renderAnswer(answer: JotformSubmissionAnswer): string | null {
  if (answer.prettyFormat !== null) return answer.prettyFormat

  const raw = answer.answer
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw)
  }
  return JSON.stringify(raw)
}

/**
 * Answers are keyed by question id, which is useless downstream without the form's
 * question list. `values` re-keys them by question label with the answer rendered as
 * text — `prettyFormat` when Jotform supplies one, the raw scalar otherwise — so a
 * submission can be read without a second call.
 *
 * Labels are not unique: a form can carry two questions both labelled "Email", and
 * keying on the label alone would silently drop all but the last. So a label is used
 * bare only when it appears once on the submission; every occurrence of a repeated
 * label is suffixed with its question id instead. Disambiguating *every* occurrence
 * rather than only the later ones keeps the result independent of answer order — and
 * makes a newly duplicated label read as absent rather than as an arbitrary winner.
 *
 * Labels are also free text, so a generated key is not automatically safe either: a
 * question literally labelled "Email (3)" collides with the key generated for a
 * duplicate "Email" at qid 3. Any key already taken is therefore widened again until
 * it is free, which makes "no answer is dropped" hold for every input rather than for
 * the labels that happen to be well behaved. `answers` remains the complete, id-keyed
 * record regardless.
 */
function buildValues(answers: Record<string, JotformSubmissionAnswer>): Record<string, string> {
  const labelCounts = new Map<string, number>()
  for (const answer of Object.values(answers)) {
    if (!answer.text) continue
    labelCounts.set(answer.text, (labelCounts.get(answer.text) ?? 0) + 1)
  }

  /* Accumulated in a Map, not an object literal: a question labelled `__proto__`
     assigned onto `{}` sets the prototype instead of an own property and vanishes.
     `Object.fromEntries` defines it as an own property. */
  const values = new Map<string, string>()
  for (const [qid, answer] of Object.entries(answers)) {
    if (!answer.text) continue
    const rendered = renderAnswer(answer)
    if (rendered === null) continue

    let key = (labelCounts.get(answer.text) ?? 0) > 1 ? `${answer.text} (${qid})` : answer.text
    while (values.has(key)) key = `${key} (${qid})`
    values.set(key, rendered)
  }
  return Object.fromEntries(values)
}

export function normalizeSubmission(raw: Record<string, unknown>): JotformSubmission {
  const answers: Record<string, JotformSubmissionAnswer> = {}
  if (isRecord(raw.answers)) {
    for (const [qid, answer] of Object.entries(raw.answers)) {
      if (isRecord(answer)) answers[qid] = normalizeAnswer(answer)
    }
  }

  return {
    id: toStringOrNull(raw.id),
    form_id: toStringOrNull(raw.form_id),
    ip: toStringOrNull(raw.ip),
    created_at: toStringOrNull(raw.created_at),
    updated_at: toStringOrNull(raw.updated_at),
    status: toStringOrNull(raw.status),
    new: toStringOrNull(raw.new),
    workflowStatus: toStringOrNull(raw.workflowStatus),
    answers,
    values: buildValues(answers),
  }
}

export function normalizeReport(raw: Record<string, unknown>): JotformReport {
  return {
    id: toStringOrNull(raw.id),
    form_id: toStringOrNull(raw.form_id),
    title: toStringOrNull(raw.title),
    fields: toStringOrNull(raw.fields),
    list_type: toStringOrNull(raw.list_type),
    status: toStringOrNull(raw.status),
    url: toStringOrNull(raw.url),
    isProtected: typeof raw.isProtected === 'boolean' ? raw.isProtected : null,
    settings: toStringOrNull(raw.settings),
    created_at: toStringOrNull(raw.created_at),
    updated_at: toStringOrNull(raw.updated_at),
  }
}

export function normalizeFile(raw: Record<string, unknown>): JotformFile {
  return {
    name: toStringOrNull(raw.name),
    type: toStringOrNull(raw.type),
    size: toStringOrNull(raw.size),
    username: toStringOrNull(raw.username),
    form_id: toStringOrNull(raw.form_id),
    submission_id: toStringOrNull(raw.submission_id),
    date: toStringOrNull(raw.date),
    url: toStringOrNull(raw.url),
  }
}

export function normalizeUser(raw: Record<string, unknown>): JotformUser {
  return {
    username: toStringOrNull(raw.username),
    name: toStringOrNull(raw.name),
    email: toStringOrNull(raw.email),
    website: toStringOrNull(raw.website),
    time_zone: toStringOrNull(raw.time_zone),
    account_type: toStringOrNull(raw.account_type),
    status: toStringOrNull(raw.status),
    created_at: toStringOrNull(raw.created_at),
    updated_at: toStringOrNull(raw.updated_at),
    is_verified: toStringOrNull(raw.is_verified),
    industry: toStringOrNull(raw.industry),
    company: toStringOrNull(raw.company),
    language: toStringOrNull(raw.language),
    avatarUrl: toStringOrNull(raw.avatarUrl),
    usage: toStringOrNull(raw.usage),
  }
}

export function normalizeSubUser(raw: Record<string, unknown>): JotformSubUser {
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter(isRecord).map((permission) => ({
        type: toStringOrNull(permission.type),
        resource_id: toStringOrNull(permission.resource_id),
        access_type: toStringOrNull(permission.access_type),
        title: toStringOrNull(permission.title),
      }))
    : []

  return {
    username: toStringOrNull(raw.username),
    email: toStringOrNull(raw.email),
    owner: toStringOrNull(raw.owner),
    status: toStringOrNull(raw.status),
    created_at: toStringOrNull(raw.created_at),
    permissions,
  }
}

export function normalizeLabel(raw: Record<string, unknown>): JotformLabel {
  return {
    id: toStringOrNull(raw.id),
    name: toStringOrNull(raw.name),
    order: toStringOrNull(raw.order),
    color: toStringOrNull(raw.color),
    owner: toStringOrNull(raw.owner),
    ownerType: toStringOrNull(raw.ownerType) ?? toStringOrNull(raw.owner_type),
    parent_label_id: toStringOrNull(raw.parent_label_id),
    created_at: toStringOrNull(raw.created_at),
    updated_at: toStringOrNull(raw.updated_at),
  }
}

/**
 * `GET /user/labels` answers with a root label whose `sublabels` nest to arbitrary
 * depth. The tree is preserved rather than flattened, because a label reads
 * differently depending on where it sits, but the recursion is depth-capped so a
 * cyclic or pathological payload cannot exhaust the stack.
 */
const MAX_LABEL_DEPTH = 32

/**
 * A label payload is one node when it is an object and a sibling list when it is an
 * array. `toList` cannot serve here: it reads a bare object as an id-keyed map, which
 * turns the documented single root label into an empty list.
 */
function toLabelNodes(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.filter(isRecord)
  return isRecord(content) ? [content] : []
}

export function normalizeLabelTree(content: unknown, depth = 0): JotformLabelNode[] {
  if (depth >= MAX_LABEL_DEPTH) return []

  return toLabelNodes(content).map((raw) => ({
    ...normalizeLabel(raw),
    sublabels: normalizeLabelTree(raw.sublabels, depth + 1),
  }))
}

export function normalizeLabelResource(raw: Record<string, unknown>): JotformLabelResource {
  return {
    id: toStringOrNull(raw.id),
    username: toStringOrNull(raw.username),
    title: toStringOrNull(raw.title),
    status: toStringOrNull(raw.status),
    assetType: toStringOrNull(raw.assetType),
    type: toStringOrNull(raw.type),
    labels: toStringOrNull(raw.labels),
    created_at: toStringOrNull(raw.created_at),
    updated_at: toStringOrNull(raw.updated_at),
  }
}

export function normalizeLabelResourceRefs(
  content: unknown
): Array<{ id: string | null; type: string | null }> {
  return toList(content).map((raw) => ({
    id: toStringOrNull(raw.id),
    type: toStringOrNull(raw.type),
  }))
}

/**
 * The add/remove endpoints take `[{id, type}]` with a lowercase type, while the
 * response echoes the type uppercase. Callers copy either casing out of the docs, so
 * the request side is normalized down rather than passed through.
 */
export function toLabelResourcePayload(
  value: unknown[] | string | undefined
): Array<{ id: string; type: string }> {
  const entries = toJsonArray(value, 'resources')
  if (entries.length === 0) {
    throw new Error('resources must contain at least one asset.')
  }

  return entries.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Every entry in resources must be a JSON object with an id and a type.')
    }
    const id = toStringOrNull(entry.id)
    const type = toStringOrNull(entry.type)
    if (!id || !type) {
      throw new Error('Every entry in resources needs both an id and a type.')
    }
    return { id, type: type.toLowerCase() }
  })
}

/**
 * Webhook lists come back as an id-keyed map, and the key IS the webhook id used by
 * `DELETE /form/{id}/webhooks/{whid}` — a bare URL array would throw that away.
 */
export function normalizeWebhooks(content: unknown): Array<{ id: string; url: string }> {
  if (Array.isArray(content)) {
    return content
      .map((url, index) => ({ id: String(index), url: toStringOrNull(url) }))
      .filter((entry): entry is { id: string; url: string } => entry.url !== null)
  }
  if (!isRecord(content)) return []
  return Object.entries(content)
    .map(([id, url]) => ({ id, url: toStringOrNull(url) }))
    .filter((entry): entry is { id: string; url: string } => entry.url !== null)
}
