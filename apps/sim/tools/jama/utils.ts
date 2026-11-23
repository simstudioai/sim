import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { normalizeJamaInstanceUrl } from '@/lib/jama/client'
import type {
  JamaBaseline,
  JamaComment,
  JamaFilter,
  JamaItem,
  JamaItemType,
  JamaItemTypeField,
  JamaPageInfo,
  JamaPickList,
  JamaPickListOption,
  JamaProject,
  JamaRelationship,
  JamaRelationshipType,
  JamaRelease,
  JamaTag,
  JamaUser,
  JamaVersion,
} from '@/tools/jama/types'
import type { OutputProperty, ToolConfig, ToolRetryConfig } from '@/tools/types'

export const jamaOAuth = {
  required: true,
  provider: 'jama',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const

export const jamaAuthParams = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Access token resolved from the selected Jama credential',
  },
  instanceUrl: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Jama instance URL bound to the selected credential',
  },
} satisfies ToolConfig['params']

export const jamaPaginationParams = {
  startAt: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Zero-based result offset (default 0)',
  },
  maxResults: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Results per page, from 1 to 50 (default 20)',
  },
} satisfies ToolConfig['params']

export const JAMA_RETRY = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  retryIdempotentOnly: true,
} as const satisfies ToolRetryConfig

export function jamaHeaders(params: { accessToken: string }): Record<string, string> {
  return {
    Authorization: `Bearer ${params.accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-jama-date-fields-with-time': 'true',
  }
}

/** Jama IDs are positive integers; validate before placing them in paths or bodies. */
export function jamaId(value: string, name: string): string {
  const id = value.trim()
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error(`${name} must be a positive integer`)
  }
  return id
}

export function jamaUrl(
  instanceUrl: string,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): string {
  const url = new URL(`${normalizeJamaInstanceUrl(instanceUrl)}/rest/v1${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function jamaPagination(params: { startAt?: number; maxResults?: number }) {
  const startAt = params.startAt ?? 0
  const maxResults = params.maxResults ?? 20
  if (!Number.isSafeInteger(startAt) || startAt < 0) {
    throw new Error('startAt must be a non-negative integer')
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
    throw new Error('maxResults must be an integer from 1 to 50')
  }
  return { startAt, maxResults }
}

export function jamaFields(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!isRecordLike(parsed) || Object.keys(parsed).length === 0) {
    throw new Error('fields must be a non-empty JSON object')
  }
  return parsed
}

export function jamaPatch(value: unknown): Array<Record<string, unknown>> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error('patch must be a JSON Patch array containing 1 to 100 operations')
  }
  return parsed.map((entry) => {
    if (
      !isRecordLike(entry) ||
      !['add', 'remove', 'replace'].includes(String(entry.op)) ||
      typeof entry.path !== 'string' ||
      !entry.path.startsWith('/') ||
      (entry.op !== 'remove' && !('value' in entry))
    ) {
      throw new Error(
        'Each patch entry needs an add, remove, or replace operation and a JSON Pointer path'
      )
    }
    return entry.op === 'remove'
      ? { op: entry.op, path: entry.path }
      : { op: entry.op, path: entry.path, value: entry.value }
  })
}

export function assertJamaResponse(response: Response): void {
  if (!response.ok) throw new Error(`Jama request failed (${response.status})`)
}

export async function readJamaEnvelope(response: Response): Promise<Record<string, unknown>> {
  assertJamaResponse(response)
  const body: unknown = await response.json()
  if (!isRecordLike(body)) throw new Error('Jama returned an invalid response')
  return body
}

export function jamaData(body: Record<string, unknown>): Record<string, unknown> {
  if (!isRecordLike(body.data)) throw new Error('Jama returned invalid resource data')
  return body.data
}

export function jamaList(body: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(body.data) || body.data.some((item) => !isRecordLike(item))) {
    throw new Error('Jama returned invalid list data')
  }
  return body.data.map(toRecord)
}

export function jamaNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Jama returned an invalid numeric identifier')
  }
  return value
}

export function jamaPageInfo(body: Record<string, unknown>): JamaPageInfo {
  const info = toRecord(toRecord(body.meta).pageInfo)
  return {
    startIndex: jamaNumber(info.startIndex),
    resultCount: jamaNumber(info.resultCount),
    totalResults: jamaNumber(info.totalResults),
  }
}

export const JAMA_PAGE_INFO_OUTPUT = {
  type: 'object',
  description: 'Pagination metadata; advance startAt by resultCount',
  properties: {
    startIndex: { type: 'number', description: 'Current zero-based result offset' },
    resultCount: { type: 'number', description: 'Results returned on this page' },
    totalResults: { type: 'number', description: 'Total matching results' },
  },
} as const satisfies OutputProperty

export function mapJamaItem(data: Record<string, unknown>): JamaItem {
  return {
    id: jamaNumber(data.id),
    documentKey: toStringOrNull(data.documentKey) ?? '',
    globalId: toStringOrNull(data.globalId),
    itemType: jamaNumber(data.itemType),
    project: jamaNumber(data.project),
    createdDate: toStringOrNull(data.createdDate),
    modifiedDate: toStringOrNull(data.modifiedDate),
    lastActivityDate: toStringOrNull(data.lastActivityDate),
    createdBy: toNumberOrNull(data.createdBy),
    modifiedBy: toNumberOrNull(data.modifiedBy),
    fields: toRecord(data.fields),
    version: toNumberOrNull(data.version),
  }
}

export const JAMA_ITEM_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  documentKey: { type: 'string', description: 'documentKey' },
  globalId: { type: 'string', description: 'globalId', nullable: true },
  itemType: { type: 'number', description: 'itemType' },
  project: { type: 'number', description: 'project' },
  createdDate: { type: 'string', description: 'createdDate', nullable: true },
  modifiedDate: { type: 'string', description: 'modifiedDate', nullable: true },
  lastActivityDate: { type: 'string', description: 'lastActivityDate', nullable: true },
  createdBy: { type: 'number', description: 'createdBy', nullable: true },
  modifiedBy: { type: 'number', description: 'modifiedBy', nullable: true },
  fields: {
    type: 'json',
    description: 'Jama field names mapped to values; fields vary by item type',
  },
  version: { type: 'number', description: 'version', nullable: true },
} as const satisfies Record<string, OutputProperty>

export function mapJamaProject(data: Record<string, unknown>): JamaProject {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name ?? toRecord(data.fields).name) ?? '',
    projectKey: toStringOrNull(data.projectKey ?? toRecord(data.fields).projectKey),
    description: toStringOrNull(data.description ?? toRecord(data.fields).description),
    isFolder: toBooleanOrNull(data.isFolder),
    createdDate: toStringOrNull(data.createdDate),
    modifiedDate: toStringOrNull(data.modifiedDate),
  }
}

export const JAMA_PROJECT_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  projectKey: { type: 'string', description: 'projectKey', nullable: true },
  description: { type: 'string', description: 'description', nullable: true },
  isFolder: { type: 'boolean', description: 'isFolder', nullable: true },
  createdDate: { type: 'string', description: 'createdDate', nullable: true },
  modifiedDate: { type: 'string', description: 'modifiedDate', nullable: true },
} as const satisfies Record<string, OutputProperty>

export function mapJamaItemType(data: Record<string, unknown>): JamaItemType {
  return {
    id: jamaNumber(data.id),
    typeKey: toStringOrNull(data.typeKey) ?? '',
    display: toStringOrNull(data.display) ?? '',
    displayPlural: toStringOrNull(data.displayPlural),
    description: toStringOrNull(data.description),
    category: toStringOrNull(data.category),
    fields: Array.isArray(data.fields)
      ? data.fields.map((field) => mapJamaItemTypeField(toRecord(field)))
      : [],
  }
}

const JAMA_ITEM_TYPE_FIELD_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  label: { type: 'string', description: 'label' },
  fieldType: { type: 'string', description: 'fieldType' },
  readOnly: { type: 'boolean', description: 'readOnly' },
  required: { type: 'boolean', description: 'required' },
  pickList: { type: 'number', description: 'pickList', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const JAMA_ITEM_TYPE_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  typeKey: { type: 'string', description: 'typeKey' },
  display: { type: 'string', description: 'display' },
  displayPlural: { type: 'string', description: 'displayPlural', nullable: true },
  description: { type: 'string', description: 'description', nullable: true },
  category: { type: 'string', description: 'category', nullable: true },
  fields: { type: 'array', items: { type: 'object', properties: JAMA_ITEM_TYPE_FIELD_PROPERTIES } },
} as const satisfies Record<string, OutputProperty>

function mapJamaItemTypeField(data: Record<string, unknown>): JamaItemTypeField {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    label: toStringOrNull(data.label) ?? '',
    fieldType: toStringOrNull(data.fieldType) ?? '',
    readOnly: data.readOnly === true,
    required: data.required === true,
    pickList: toNumberOrNull(data.pickList),
  }
}

export function mapJamaRelationship(data: Record<string, unknown>): JamaRelationship {
  return {
    id: jamaNumber(data.id),
    fromItem: jamaNumber(data.fromItem),
    toItem: jamaNumber(data.toItem),
    relationshipType: jamaNumber(data.relationshipType),
    suspect: data.suspect === true,
  }
}

export const JAMA_RELATIONSHIP_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  fromItem: { type: 'number', description: 'fromItem' },
  toItem: { type: 'number', description: 'toItem' },
  relationshipType: { type: 'number', description: 'relationshipType' },
  suspect: { type: 'boolean', description: 'suspect' },
} as const satisfies Record<string, OutputProperty>

export function mapJamaRelationshipType(data: Record<string, unknown>): JamaRelationshipType {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
  }
}

export const JAMA_RELATIONSHIP_TYPE_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  description: { type: 'string', description: 'description', nullable: true },
} as const satisfies Record<string, OutputProperty>

export function mapJamaComment(data: Record<string, unknown>): JamaComment {
  return {
    id: jamaNumber(data.id),
    inReplyTo: toNumberOrNull(data.inReplyTo),
    createdDate: toStringOrNull(data.createdDate),
    createdBy: toNumberOrNull(data.createdBy),
    status: toStringOrNull(data.status),
    text: toStringOrNull(toRecord(data.body).text) ?? '',
    item: toNumberOrNull(toRecord(data.location).item),
    project: toNumberOrNull(toRecord(data.location).project),
  }
}

export const JAMA_COMMENT_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  inReplyTo: { type: 'number', description: 'inReplyTo', nullable: true },
  createdDate: { type: 'string', description: 'createdDate', nullable: true },
  createdBy: { type: 'number', description: 'createdBy', nullable: true },
  status: { type: 'string', description: 'status', nullable: true },
  text: { type: 'string', description: 'text' },
  item: { type: 'number', description: 'item', nullable: true },
  project: { type: 'number', description: 'project', nullable: true },
} as const satisfies Record<string, OutputProperty>

export function mapJamaVersion(data: Record<string, unknown>): JamaVersion {
  return {
    item: jamaNumber(data.item),
    versionNumber: jamaNumber(data.versionNumber),
    changeDetails: toStringOrNull(data.changeDetails),
    comment: toStringOrNull(data.comment),
    createdDate: toStringOrNull(data.createdDate),
    createdBy: toNumberOrNull(data.createdBy),
    userName: toStringOrNull(data.userName),
  }
}

export const JAMA_VERSION_PROPERTIES = {
  item: { type: 'number', description: 'item' },
  versionNumber: { type: 'number', description: 'versionNumber' },
  changeDetails: { type: 'string', description: 'changeDetails', nullable: true },
  comment: { type: 'string', description: 'comment', nullable: true },
  createdDate: { type: 'string', description: 'createdDate', nullable: true },
  createdBy: { type: 'number', description: 'createdBy', nullable: true },
  userName: { type: 'string', description: 'userName', nullable: true },
} as const satisfies Record<string, OutputProperty>

export function mapJamaFilter(data: Record<string, unknown>): JamaFilter {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    author: toNumberOrNull(data.author),
    projectScope: toStringOrNull(data.projectScope),
    specifiedProject: toNumberOrNull(data.specifiedProject),
    public: data.public === true,
  }
}

export const JAMA_FILTER_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  author: { type: 'number', description: 'author', nullable: true },
  projectScope: { type: 'string', description: 'projectScope', nullable: true },
  specifiedProject: { type: 'number', description: 'specifiedProject', nullable: true },
  public: { type: 'boolean', description: 'public' },
} as const satisfies Record<string, OutputProperty>

export function mapJamaBaseline(data: Record<string, unknown>): JamaBaseline {
  return {
    id: jamaNumber(data.id),
    baselineKey: toStringOrNull(data.baselineKey),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    createdDate: toStringOrNull(data.createdDate),
    createdBy: toNumberOrNull(data.createdBy),
    project: jamaNumber(data.project),
    sourceName: toStringOrNull(data.sourceName),
    signed: data.signed === true,
  }
}

export const JAMA_BASELINE_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  baselineKey: { type: 'string', description: 'baselineKey', nullable: true },
  name: { type: 'string', description: 'name' },
  description: { type: 'string', description: 'description', nullable: true },
  createdDate: { type: 'string', description: 'createdDate', nullable: true },
  createdBy: { type: 'number', description: 'createdBy', nullable: true },
  project: { type: 'number', description: 'project' },
  sourceName: { type: 'string', description: 'sourceName', nullable: true },
  signed: { type: 'boolean', description: 'signed' },
} as const satisfies Record<string, OutputProperty>

export function mapJamaRelease(data: Record<string, unknown>): JamaRelease {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    project: jamaNumber(data.project),
    releaseDate: toStringOrNull(data.releaseDate),
    active: data.active === true,
    archived: data.archived === true,
    itemCount: jamaNumber(data.itemCount),
  }
}

export const JAMA_RELEASE_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  description: { type: 'string', description: 'description', nullable: true },
  project: { type: 'number', description: 'project' },
  releaseDate: { type: 'string', description: 'releaseDate', nullable: true },
  active: { type: 'boolean', description: 'active' },
  archived: { type: 'boolean', description: 'archived' },
  itemCount: { type: 'number', description: 'itemCount' },
} as const satisfies Record<string, OutputProperty>

export function mapJamaTag(data: Record<string, unknown>): JamaTag {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    project: jamaNumber(data.project),
  }
}

export const JAMA_TAG_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  project: { type: 'number', description: 'project' },
} as const satisfies Record<string, OutputProperty>

export function mapJamaPickList(data: Record<string, unknown>): JamaPickList {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
  }
}

export const JAMA_PICK_LIST_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  description: { type: 'string', description: 'description', nullable: true },
} as const satisfies Record<string, OutputProperty>

export function mapJamaPickListOption(data: Record<string, unknown>): JamaPickListOption {
  return {
    id: jamaNumber(data.id),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    value: toStringOrNull(data.value),
    active: data.active === true,
    pickList: jamaNumber(data.pickList),
  }
}

export const JAMA_PICK_LIST_OPTION_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  name: { type: 'string', description: 'name' },
  description: { type: 'string', description: 'description', nullable: true },
  value: { type: 'string', description: 'value', nullable: true },
  active: { type: 'boolean', description: 'active' },
  pickList: { type: 'number', description: 'pickList' },
} as const satisfies Record<string, OutputProperty>

export function mapJamaUser(data: Record<string, unknown>): JamaUser {
  return {
    id: jamaNumber(data.id),
    username: toStringOrNull(data.username) ?? '',
    firstName: toStringOrNull(data.firstName) ?? '',
    lastName: toStringOrNull(data.lastName) ?? '',
    email: toStringOrNull(data.email) ?? '',
    active: data.active === true,
    licenseType: toStringOrNull(data.licenseType) ?? '',
  }
}

export const JAMA_USER_PROPERTIES = {
  id: { type: 'number', description: 'id' },
  username: { type: 'string', description: 'username' },
  firstName: { type: 'string', description: 'firstName' },
  lastName: { type: 'string', description: 'lastName' },
  email: { type: 'string', description: 'email' },
  active: { type: 'boolean', description: 'active' },
  licenseType: { type: 'string', description: 'licenseType' },
} as const satisfies Record<string, OutputProperty>
