/**
 * Client-safe catalog of Microsoft Presidio PII entity types. Single source of
 * truth shared by the server-only validator (`validate_pii.ts`) and client
 * settings UI — keep no node-only imports here.
 */
export const SUPPORTED_PII_ENTITIES = {
  // Common/Global
  CREDIT_CARD: 'Credit card number',
  CRYPTO: 'Cryptocurrency wallet address',
  DATE_TIME: 'Date or time',
  EMAIL_ADDRESS: 'Email address',
  IBAN_CODE: 'International Bank Account Number',
  IP_ADDRESS: 'IP address',
  NRP: 'Nationality, religious or political group',
  LOCATION: 'Location',
  PERSON: 'Person name',
  PHONE_NUMBER: 'Phone number',
  MEDICAL_LICENSE: 'Medical license number',
  URL: 'URL',
  VIN: 'Vehicle Identification Number',

  // USA
  US_BANK_NUMBER: 'US bank account number',
  US_DRIVER_LICENSE: 'US driver license',
  US_ITIN: 'US Individual Taxpayer Identification Number',
  US_PASSPORT: 'US passport number',
  US_SSN: 'US Social Security Number',

  // UK
  UK_NHS: 'UK NHS number',
  UK_NINO: 'UK National Insurance Number',

  // Other countries
  ES_NIF: 'Spanish NIF number',
  ES_NIE: 'Spanish NIE number',
  IT_FISCAL_CODE: 'Italian fiscal code',
  IT_DRIVER_LICENSE: 'Italian driver license',
  IT_VAT_CODE: 'Italian VAT code',
  IT_PASSPORT: 'Italian passport',
  IT_IDENTITY_CARD: 'Italian identity card',
  PL_PESEL: 'Polish PESEL number',
  SG_NRIC_FIN: 'Singapore NRIC/FIN',
  SG_UEN: 'Singapore Unique Entity Number',
  AU_ABN: 'Australian Business Number',
  AU_ACN: 'Australian Company Number',
  AU_TFN: 'Australian Tax File Number',
  AU_MEDICARE: 'Australian Medicare number',
  IN_PAN: 'Indian Permanent Account Number',
  IN_AADHAAR: 'Indian Aadhaar number',
  IN_VEHICLE_REGISTRATION: 'Indian vehicle registration',
  IN_VOTER: 'Indian voter ID',
  IN_PASSPORT: 'Indian passport',
  FI_PERSONAL_IDENTITY_CODE: 'Finnish Personal Identity Code',
} as const

export type PIIEntityType = keyof typeof SUPPORTED_PII_ENTITIES

/** Flat `{ value, label }` options for entity-type pickers, in catalog order. */
export const PII_ENTITY_OPTIONS: ReadonlyArray<{ value: PIIEntityType; label: string }> =
  Object.entries(SUPPORTED_PII_ENTITIES).map(([value, label]) => ({
    value: value as PIIEntityType,
    label,
  }))

/** Entity types grouped by region, for a grouped checkbox picker. */
export const PII_ENTITY_GROUPS: ReadonlyArray<{
  label: string
  entities: ReadonlyArray<{ value: PIIEntityType; label: string }>
}> = [
  {
    label: 'Common',
    entities: [
      'PERSON',
      'EMAIL_ADDRESS',
      'PHONE_NUMBER',
      'CREDIT_CARD',
      'IP_ADDRESS',
      'LOCATION',
      'DATE_TIME',
      'URL',
      'IBAN_CODE',
      'CRYPTO',
      'NRP',
      'MEDICAL_LICENSE',
      'VIN',
    ],
  },
  {
    label: 'United States',
    entities: ['US_SSN', 'US_PASSPORT', 'US_DRIVER_LICENSE', 'US_BANK_NUMBER', 'US_ITIN'],
  },
  { label: 'United Kingdom', entities: ['UK_NHS', 'UK_NINO'] },
  {
    label: 'Other regions',
    entities: [
      'ES_NIF',
      'ES_NIE',
      'IT_FISCAL_CODE',
      'IT_DRIVER_LICENSE',
      'IT_VAT_CODE',
      'IT_PASSPORT',
      'IT_IDENTITY_CARD',
      'PL_PESEL',
      'SG_NRIC_FIN',
      'SG_UEN',
      'AU_ABN',
      'AU_ACN',
      'AU_TFN',
      'AU_MEDICARE',
      'IN_PAN',
      'IN_AADHAAR',
      'IN_VEHICLE_REGISTRATION',
      'IN_VOTER',
      'IN_PASSPORT',
      'FI_PERSONAL_IDENTITY_CODE',
    ],
  },
].map((group) => ({
  label: group.label,
  entities: group.entities.map((value) => ({
    value: value as PIIEntityType,
    label: SUPPORTED_PII_ENTITIES[value as PIIEntityType],
  })),
}))

/**
 * Languages the Presidio image has NLP models for. The analyzer only recognizes a
 * language's entities when its model is loaded, so this set must match the image.
 */
export const PII_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pl', label: 'Polish' },
  { value: 'fi', label: 'Finnish' },
] as const

export type PIILanguage = (typeof PII_LANGUAGES)[number]['value']

/** Non-empty tuple of language codes for schema/enum use. */
export const PII_LANGUAGE_CODES = PII_LANGUAGES.map((l) => l.value) as [
  PIILanguage,
  ...PIILanguage[],
]

/** Default redaction language when a rule doesn't set one. */
export const DEFAULT_PII_LANGUAGE: PIILanguage = 'en'

/**
 * Narrow a loosely-typed (stored/legacy) language to a supported code. Unknown or
 * stale values (e.g. a dropped locale) return `undefined` so callers fall back to
 * the default rather than forwarding an unsupported language to Presidio.
 */
export function coercePiiLanguage(value: string | undefined): PIILanguage | undefined {
  return value && (PII_LANGUAGE_CODES as readonly string[]).includes(value)
    ? (value as PIILanguage)
    : undefined
}

/**
 * Entity types every served language recognizes: Presidio's global pattern
 * recognizers, the spaCy NER entities (PERSON/LOCATION/NRP), and the native VIN
 * recognizer (registered under every language in `apps/pii/server.py`).
 */
const GLOBAL_PII_ENTITIES: readonly PIIEntityType[] = [
  'PERSON',
  'LOCATION',
  'NRP',
  'CREDIT_CARD',
  'CRYPTO',
  'DATE_TIME',
  'EMAIL_ADDRESS',
  'IBAN_CODE',
  'IP_ADDRESS',
  'PHONE_NUMBER',
  'URL',
  'MEDICAL_LICENSE',
  'VIN',
]

/**
 * Entity types each language recognizes, mirroring the recognizer registration in
 * `apps/pii/server.py`: globals + NER + VIN everywhere, plus the locale-specific
 * id recognizers under the language they're registered for (US/UK/AU/IN/SG ids
 * are English; es/it/pl/fi carry only their own national ids). Keep in sync with
 * the image — a stale entry only no-ops (redaction fails safe), it never leaks.
 * `/supportedentities` is the authoritative source if this ever needs to go live.
 */
export const PII_ENTITIES_BY_LANGUAGE: Record<PIILanguage, ReadonlySet<PIIEntityType>> = {
  en: new Set<PIIEntityType>([
    ...GLOBAL_PII_ENTITIES,
    'US_SSN',
    'US_PASSPORT',
    'US_DRIVER_LICENSE',
    'US_BANK_NUMBER',
    'US_ITIN',
    'UK_NHS',
    'UK_NINO',
    'AU_ABN',
    'AU_ACN',
    'AU_TFN',
    'AU_MEDICARE',
    'IN_PAN',
    'IN_AADHAAR',
    'IN_VEHICLE_REGISTRATION',
    'IN_VOTER',
    'IN_PASSPORT',
    'SG_NRIC_FIN',
    'SG_UEN',
  ]),
  es: new Set<PIIEntityType>([...GLOBAL_PII_ENTITIES, 'ES_NIF', 'ES_NIE']),
  it: new Set<PIIEntityType>([
    ...GLOBAL_PII_ENTITIES,
    'IT_FISCAL_CODE',
    'IT_DRIVER_LICENSE',
    'IT_VAT_CODE',
    'IT_PASSPORT',
    'IT_IDENTITY_CARD',
  ]),
  pl: new Set<PIIEntityType>([...GLOBAL_PII_ENTITIES, 'PL_PESEL']),
  fi: new Set<PIIEntityType>([...GLOBAL_PII_ENTITIES, 'FI_PERSONAL_IDENTITY_CODE']),
}

/** True when the entity has a recognizer for the given language. */
export function isEntitySupportedForLanguage(
  entity: PIIEntityType,
  language: PIILanguage
): boolean {
  return PII_ENTITIES_BY_LANGUAGE[language].has(entity)
}

/**
 * Entity types produced by the spaCy NER model (vs the regex/checksum pattern
 * recognizers). The block-output redaction stage is restricted to the non-NER
 * (regex) entities so it runs on the Presidio spaCy-free fast path without the
 * per-leaf NER cost. Includes ORGANIZATION — which Presidio's spaCy recognizer
 * emits but the user-facing catalog above does not list — so it too is stripped
 * from block-output selections, keeping this in sync with the derived
 * `NER_ENTITIES` in `apps/pii/server.py`. Typed as strings because ORGANIZATION
 * isn't a catalog `PIIEntityType`.
 */
export const NER_PII_ENTITIES: ReadonlySet<string> = new Set<string>([
  'PERSON',
  'LOCATION',
  'NRP',
  'DATE_TIME',
  'ORGANIZATION',
])

/** Drop the spaCy-NER entities ({@link NER_PII_ENTITIES}) from a selection. */
export function stripNerEntities(entities: readonly string[]): string[] {
  return entities.filter((e) => !NER_PII_ENTITIES.has(e))
}

/**
 * {@link PII_ENTITY_GROUPS} filtered to entities the language recognizes (empty
 * groups dropped). With `regexOnly`, the spaCy-NER entities are also excluded —
 * used for the block-output stage.
 */
export function getEntityGroupsForLanguage(language: PIILanguage, opts?: { regexOnly?: boolean }) {
  const regexOnly = opts?.regexOnly ?? false
  return PII_ENTITY_GROUPS.map((group) => ({
    label: group.label,
    entities: group.entities.filter(
      (e) =>
        isEntitySupportedForLanguage(e.value, language) &&
        (!regexOnly || !NER_PII_ENTITIES.has(e.value))
    ),
  })).filter((group) => group.entities.length > 0)
}

/** The PII redaction stages, in execution order. */
export const PII_STAGES = ['input', 'blockOutputs', 'logs'] as const
export type PiiStageKey = (typeof PII_STAGES)[number]

/** Per-stage redaction policy. `enabled: false` makes the stage a no-op. */
export interface PiiStagePolicy {
  enabled: boolean
  entityTypes: string[]
  language: PIILanguage
}

export type PiiStages = Record<PiiStageKey, PiiStagePolicy>

/**
 * Stage catalog driving the settings UI, in display order (Logs first — the
 * safe, observability-only default). The execution-altering caveat for the
 * input/blockOutputs stages is folded into their descriptions.
 */
export const PII_STAGE_META: ReadonlyArray<{
  key: PiiStageKey
  label: string
  description: string
}> = [
  {
    key: 'logs',
    label: 'Logs',
    description: 'Redact workflow logs when they are persisted.',
  },
  {
    key: 'input',
    label: 'Workflow input',
    description:
      'Redact the workflow input before execution. Data is redacted during runtime and may affect workflow output.',
  },
  {
    key: 'blockOutputs',
    label: 'Block outputs',
    description:
      'Mask every block output before the next block reads it. Data is redacted during runtime and may affect workflow output and execution performance.',
  },
]

/** Recognizers that over-redact (loose, no checksum); surfaced as UI guidance. */
export const RISKY_PII_ENTITIES: ReadonlySet<PIIEntityType> = new Set<PIIEntityType>([
  'US_SSN',
  'US_BANK_NUMBER',
  'DATE_TIME',
])

/** A fully-disabled stage policy for new drafts. */
export function emptyStagePolicy(): PiiStagePolicy {
  return { enabled: false, entityTypes: [], language: DEFAULT_PII_LANGUAGE }
}

/** A fully-disabled stage set for new drafts. */
export function emptyPiiStages(): PiiStages {
  return {
    input: emptyStagePolicy(),
    blockOutputs: emptyStagePolicy(),
    logs: emptyStagePolicy(),
  }
}

/**
 * Hydrate a stored rule into the per-stage shape. A legacy flat rule (no
 * `stages`) becomes `logs` enabled with its entity types, the two new stages
 * disabled — exactly its pre-stages behavior.
 */
export function normalizeRuleStages(rule: {
  stages?: Partial<Record<PiiStageKey, Partial<PiiStagePolicy> | undefined>>
  entityTypes?: string[]
  language?: string
}): PiiStages {
  const sanitize = (policy: Partial<PiiStagePolicy> | undefined): PiiStagePolicy => ({
    enabled: Boolean(policy?.enabled),
    entityTypes: Array.isArray(policy?.entityTypes)
      ? policy.entityTypes.filter((t): t is string => typeof t === 'string')
      : [],
    language: coercePiiLanguage(policy?.language) ?? DEFAULT_PII_LANGUAGE,
  })

  if (rule.stages) {
    // Block outputs are regex-only (no spaCy NER) — strip NER from any stored
    // rule so hydrated drafts never carry it; a stage left empty becomes disabled.
    const blockOutputs = sanitize(rule.stages.blockOutputs)
    const blockOutputsEntities = stripNerEntities(blockOutputs.entityTypes)
    return {
      input: sanitize(rule.stages.input),
      blockOutputs: {
        ...blockOutputs,
        entityTypes: blockOutputsEntities,
        enabled: blockOutputs.enabled && blockOutputsEntities.length > 0,
      },
      logs: sanitize(rule.stages.logs),
    }
  }

  const entityTypes = Array.isArray(rule.entityTypes)
    ? rule.entityTypes.filter((t): t is string => typeof t === 'string')
    : []
  return {
    input: emptyStagePolicy(),
    blockOutputs: emptyStagePolicy(),
    logs: {
      enabled: entityTypes.length > 0,
      entityTypes,
      language: coercePiiLanguage(rule.language) ?? DEFAULT_PII_LANGUAGE,
    },
  }
}
