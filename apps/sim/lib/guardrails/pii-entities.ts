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
