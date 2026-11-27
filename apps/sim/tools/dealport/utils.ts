import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  DealportBuildingSummary,
  DealportCompanySummary,
  DealportFindOwnerParams,
  DealportMarketFilter,
  DealportMatchCompaniesParams,
  DealportMatchedCompanyRow,
  DealportMatchInputItem,
  DealportMetricEstimate,
  DealportOwnerEducation,
  DealportOwnerEmail,
  DealportOwnerPerson,
  DealportOwnerPhone,
  DealportOwnerProfile,
  DealportOwnerRole,
  DealportPreviewCompaniesParams,
  DealportPreviewSampleCompany,
  DealportRecord,
  DealportRecordFact,
  DealportRecordIdentifier,
  DealportRecordPerson,
  DealportRecordSource,
  DealportSearchBuildingsParams,
  DealportSearchCompaniesParams,
} from '@/tools/dealport/types'

/**
 * Base URL for the Dealport V4 REST API.
 * @see https://dealport.com/docs
 */
export const DEALPORT_API_BASE = 'https://app.dealport.com/api/v1'

/** Dealport authenticates requests with a `dp_live_` workspace API key sent as a Bearer token. */
export function dealportHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
}

/** Headers for JSON POST requests to the Dealport V4 REST API. */
export function dealportJsonHeaders(accessToken: string): Record<string, string> {
  return {
    ...dealportHeaders(accessToken),
    'Content-Type': 'application/json',
  }
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parseStringValues(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
    return items.length > 0 ? items : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parseStringValues(parsed)
      } catch {
        // Fall back to comma-separated splitting when not JSON.
      }
    }
    const items = trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    return items.length > 0 ? items : undefined
  }
  return undefined
}

function toCommaSeparated(value: unknown): string | undefined {
  const items = parseStringValues(value)
  return items ? items.join(',') : undefined
}

function parsePreviewMarkets(value: unknown): DealportMarketFilter[] | undefined {
  if (value === undefined || value === null) return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (!trimmed.startsWith('[')) {
      const markets = trimmed
        .split('|')
        .map((segment): DealportMarketFilter | null => {
          const [rawState, rawCounties] = segment.split(':')
          const state = rawState?.trim().toUpperCase()
          if (!state) return null
          const counties = rawCounties
            ? rawCounties
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean)
            : undefined
          return counties && counties.length > 0 ? { state, counties } : { state }
        })
        .filter((entry): entry is DealportMarketFilter => entry !== null)
      return markets.length > 0 ? markets : undefined
    }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('markets must be a valid JSON array of {state, counties} objects')
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('markets must be an array of {state, counties} objects')
  }
  const markets: DealportMarketFilter[] = []
  for (const item of parsed) {
    const record = toRecordOrNull(item)
    const state = trimmedString(record?.state)?.toUpperCase()
    if (!state) {
      throw new Error('Each entry in markets must include a two-letter state code')
    }
    const counties = parseStringValues(record?.counties)
    markets.push(counties ? { state, counties } : { state })
  }
  return markets.length > 0 ? markets : undefined
}

/** Builds the JSON request body for `POST /companies/preview`. */
export function buildPreviewCompaniesBody(
  params: DealportPreviewCompaniesParams
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const q = trimmedString(params.q)
  if (q) body.q = q
  const state = trimmedString(params.state)?.toUpperCase()
  if (state) body.state = state
  const counties = parseStringValues(params.counties)
  if (counties) body.counties = counties
  const cities = parseStringValues(params.cities)
  if (cities) body.cities = cities
  const markets = parsePreviewMarkets(params.markets)
  if (markets) body.markets = markets
  const domain = trimmedString(params.domain)
  if (domain) body.domain = domain
  const naics = parseStringValues(params.naics)
  if (naics) body.naics = naics
  if (typeof params.min_revenue === 'number' && Number.isFinite(params.min_revenue)) {
    body.min_revenue = params.min_revenue
  }
  if (typeof params.max_revenue === 'number' && Number.isFinite(params.max_revenue)) {
    body.max_revenue = params.max_revenue
  }
  if (typeof params.filed_revenue_only === 'boolean') {
    body.filed_revenue_only = params.filed_revenue_only
  }
  if (typeof params.min_employees === 'number' && Number.isFinite(params.min_employees)) {
    body.min_employees = params.min_employees
  }
  if (typeof params.max_employees === 'number' && Number.isFinite(params.max_employees)) {
    body.max_employees = params.max_employees
  }
  if (typeof params.size_unknown === 'boolean') body.size_unknown = params.size_unknown
  if (typeof params.independent === 'boolean') body.independent = params.independent
  if (typeof params.owner_businesses === 'number' && Number.isFinite(params.owner_businesses)) {
    body.owner_businesses = params.owner_businesses
  }
  if (typeof params.medicare === 'boolean') body.medicare = params.medicare
  if (typeof params.owner_operated === 'boolean') body.owner_operated = params.owner_operated
  if (typeof params.owner_contact === 'boolean') body.owner_contact = params.owner_contact
  if (typeof params.licensed === 'boolean') body.licensed = params.licensed
  const careTypes = parseStringValues(params.care_types)
  if (careTypes) body.care_types = careTypes
  if (typeof params.adviser === 'boolean') body.adviser = params.adviser
  if (typeof params.wealth_adviser === 'boolean') body.wealth_adviser = params.wealth_adviser
  if (typeof params.online_store === 'boolean') body.online_store = params.online_store
  const sells = parseStringValues(params.sells)
  if (sells) body.sells = sells
  const storeWords = parseStringValues(params.store_words)
  if (storeWords) body.store_words = storeWords
  if (typeof params.min_reviews === 'number' && Number.isFinite(params.min_reviews)) {
    body.min_reviews = params.min_reviews
  }
  const order = trimmedString(params.order)
  if (order) body.order = order
  return body
}

/** Builds the URL with query parameters for `GET /companies`. */
export function buildSearchCompaniesUrl(params: DealportSearchCompaniesParams): string {
  const qs = new URLSearchParams()
  const q = trimmedString(params.q)
  if (q) qs.set('q', q)
  const state = trimmedString(params.state)?.toUpperCase()
  if (state) qs.set('state', state)
  const counties = toCommaSeparated(params.counties)
  if (counties) qs.set('counties', counties)
  const cities = toCommaSeparated(params.cities)
  if (cities) qs.set('cities', cities)
  const markets = trimmedString(params.markets)
  if (markets) qs.set('markets', markets)
  const domain = trimmedString(params.domain)
  if (domain) qs.set('domain', domain)
  const naics = toCommaSeparated(params.naics)
  if (naics) qs.set('naics', naics)
  if (typeof params.min_revenue === 'number' && Number.isFinite(params.min_revenue)) {
    qs.set('min_revenue', String(params.min_revenue))
  }
  if (typeof params.max_revenue === 'number' && Number.isFinite(params.max_revenue)) {
    qs.set('max_revenue', String(params.max_revenue))
  }
  if (typeof params.filed_revenue_only === 'boolean') {
    qs.set('filed_revenue_only', String(params.filed_revenue_only))
  }
  if (typeof params.min_employees === 'number' && Number.isFinite(params.min_employees)) {
    qs.set('min_employees', String(params.min_employees))
  }
  if (typeof params.max_employees === 'number' && Number.isFinite(params.max_employees)) {
    qs.set('max_employees', String(params.max_employees))
  }
  if (typeof params.size_unknown === 'boolean') qs.set('size_unknown', String(params.size_unknown))
  if (typeof params.independent === 'boolean') qs.set('independent', String(params.independent))
  if (typeof params.owner_businesses === 'number' && Number.isFinite(params.owner_businesses)) {
    qs.set('owner_businesses', String(params.owner_businesses))
  }
  if (typeof params.medicare === 'boolean') qs.set('medicare', String(params.medicare))
  if (typeof params.owner_operated === 'boolean') {
    qs.set('owner_operated', String(params.owner_operated))
  }
  if (typeof params.owner_contact === 'boolean') {
    qs.set('owner_contact', String(params.owner_contact))
  }
  if (typeof params.licensed === 'boolean') qs.set('licensed', String(params.licensed))
  const careTypes = toCommaSeparated(params.care_types)
  if (careTypes) qs.set('care_types', careTypes)
  if (typeof params.adviser === 'boolean') qs.set('adviser', String(params.adviser))
  if (typeof params.wealth_adviser === 'boolean') {
    qs.set('wealth_adviser', String(params.wealth_adviser))
  }
  if (typeof params.online_store === 'boolean') qs.set('online_store', String(params.online_store))
  const sells = toCommaSeparated(params.sells)
  if (sells) qs.set('sells', sells)
  const storeWords = toCommaSeparated(params.store_words)
  if (storeWords) qs.set('store_words', storeWords)
  if (typeof params.min_reviews === 'number' && Number.isFinite(params.min_reviews)) {
    qs.set('min_reviews', String(params.min_reviews))
  }
  const order = trimmedString(params.order)
  if (order) qs.set('order', order)
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    qs.set('limit', String(params.limit))
  }
  const cursor = trimmedString(params.cursor)
  if (cursor) qs.set('cursor', cursor)
  const query = qs.toString()
  return query ? `${DEALPORT_API_BASE}/companies?${query}` : `${DEALPORT_API_BASE}/companies`
}

/** Builds the URL with query parameters for `GET /buildings`. */
export function buildSearchBuildingsUrl(params: DealportSearchBuildingsParams): string {
  const borough = trimmedString(params.borough)?.toUpperCase()
  if (!borough) {
    throw new Error('borough is required (MN, BK, QN, BX, or SI)')
  }
  const qs = new URLSearchParams()
  qs.set('borough', borough)
  if (typeof params.min_units === 'number' && Number.isFinite(params.min_units)) {
    qs.set('min_units', String(params.min_units))
  }
  const q = trimmedString(params.q)
  if (q) qs.set('q', q)
  if (typeof params.loan_due_by === 'number' && Number.isFinite(params.loan_due_by)) {
    qs.set('loan_due_by', String(params.loan_due_by))
  }
  const loanHolder = trimmedString(params.loan_holder)
  if (loanHolder) qs.set('loan_holder', loanHolder)
  const signal = trimmedString(params.signal)
  if (signal) qs.set('signal', signal)
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    qs.set('limit', String(params.limit))
  }
  const cursor = trimmedString(params.cursor)
  if (cursor) qs.set('cursor', cursor)
  return `${DEALPORT_API_BASE}/buildings?${qs.toString()}`
}

function parseMatchItems(value: unknown): DealportMatchInputItem[] | undefined {
  if (value === undefined || value === null) return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('items must be a valid JSON array of company objects')
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('items must be a JSON array of company objects')
  }
  if (parsed.length === 0 || parsed.length > 250) {
    throw new Error('items must contain between 1 and 250 company objects')
  }
  return parsed.map((entry, idx) => {
    const record = toRecordOrNull(entry)
    if (!record || Array.isArray(entry)) {
      throw new Error(`items[${idx}] must be an object`)
    }
    const item: DealportMatchInputItem = {}
    const externalId = trimmedString(record.external_id)
    if (externalId) item.external_id = externalId
    const name = trimmedString(record.name)
    if (name) item.name = name
    const domain = trimmedString(record.domain)
    if (domain) item.domain = domain
    const city = trimmedString(record.city)
    if (city) item.city = city
    const state = trimmedString(record.state)
    if (state) item.state = state
    return item
  })
}

/** Builds and validates the JSON request body for `POST /companies/match`. */
export function buildMatchCompaniesBody(
  params: DealportMatchCompaniesParams
): Record<string, unknown> {
  const items = parseMatchItems(params.items)
  const csv = typeof params.csv === 'string' && params.csv.trim() ? params.csv.trim() : undefined
  if (!items && !csv) {
    throw new Error('Provide either items (JSON array) or csv (CSV text) to match companies')
  }
  if (items && csv) {
    throw new Error('Provide either items or csv, not both')
  }
  const body: Record<string, unknown> = {}
  if (items) body.items = items
  if (csv) body.csv = csv
  if (typeof params.watch === 'boolean') body.watch = params.watch
  const projectId = trimmedString(params.project_id)
  if (projectId) body.project_id = projectId
  const projectName = trimmedString(params.project_name)
  if (projectName) body.project_name = projectName
  return body
}

/** Builds and validates the JSON request body for `POST /owners`. */
export function buildFindOwnerBody(params: DealportFindOwnerParams): Record<string, unknown> {
  const companyId = trimmedString(params.company_id)
  const llcName = trimmedString(params.llc_name)
  const propertyAddress = trimmedString(params.property_address)
  if (!companyId && !llcName && !propertyAddress) {
    throw new Error('Provide at least one of company_id, llc_name, or property_address')
  }
  const body: Record<string, unknown> = {}
  if (companyId) body.company_id = companyId
  if (llcName) body.llc_name = llcName
  if (propertyAddress) body.property_address = propertyAddress
  const state = trimmedString(params.state)?.toUpperCase()
  if (state) body.state = state
  const city = trimmedString(params.city)
  if (city) body.city = city
  const mailingAddress = trimmedString(params.mailing_address)
  if (mailingAddress) body.mailing_address = mailingAddress
  const careOf = trimmedString(params.care_of)
  if (careOf) body.care_of = careOf
  const person = trimmedString(params.person)
  if (person) body.person = person
  return body
}

/** Maps one sample company from `POST /companies/preview`. */
export function mapPreviewSampleCompany(raw: unknown): DealportPreviewSampleCompany {
  const item = toRecord(raw)
  return {
    id: toStringOrNull(item.id) ?? '',
    name: toStringOrNull(item.name) ?? '',
    city: toStringOrNull(item.city),
    state: toStringOrNull(item.state),
    industry: toStringOrNull(item.industry),
    employee_band: toStringOrNull(item.employee_band),
    revenue_band: toStringOrNull(item.revenue_band),
    independent: toBooleanOrNull(item.independent) ?? false,
  }
}

function mapMetricEstimate(raw: unknown): DealportMetricEstimate {
  const item = toRecord(raw)
  return {
    value: toNumberOrNull(item.value),
    low: toNumberOrNull(item.low),
    high: toNumberOrNull(item.high),
    basis: toStringOrNull(item.basis),
  }
}

function mapStringArray(raw: unknown): string[] {
  return toArray(raw).flatMap((entry) => {
    const str = toStringOrNull(entry)
    return str !== null ? [str] : []
  })
}

/** Maps one company summary from `GET /companies`. */
export function mapCompanySummary(raw: unknown): DealportCompanySummary {
  const item = toRecord(raw)
  const owner = toRecordOrNull(item.owner)
  const ownerName = toStringOrNull(owner?.name)
  return {
    id: toStringOrNull(item.id) ?? '',
    name: toStringOrNull(item.name) ?? '',
    city: toStringOrNull(item.city),
    state: toStringOrNull(item.state),
    zip: toStringOrNull(item.zip),
    naics: mapStringArray(item.naics),
    industry: mapStringArray(item.industry),
    industryLabel: toStringOrNull(item.industryLabel),
    phone: toStringOrNull(item.phone),
    website: toStringOrNull(item.website),
    revenue: mapMetricEstimate(item.revenue),
    employees: mapMetricEstimate(item.employees),
    owner: ownerName ? { name: ownerName, role: toStringOrNull(owner?.role) } : null,
    sources: toNumberOrNull(item.sources) ?? 0,
    foundedYear: toNumberOrNull(item.foundedYear),
  }
}

/** Maps one NYC building summary from `GET /buildings`. */
export function mapBuildingSummary(raw: unknown): DealportBuildingSummary {
  const item = toRecord(raw)
  const loan = toRecordOrNull(item.loan)
  return {
    bbl: toStringOrNull(item.bbl) ?? '',
    borough: toStringOrNull(item.borough) ?? '',
    address: toStringOrNull(item.address) ?? '',
    owner_of_record: toStringOrNull(item.owner_of_record),
    residential_units: toNumberOrNull(item.residential_units),
    building_class: toStringOrNull(item.building_class),
    year_built: toNumberOrNull(item.year_built),
    zoning: toStringOrNull(item.zoning),
    rent_stabilized_units: toNumberOrNull(item.rent_stabilized_units),
    loan: loan
      ? {
          holder_type: toStringOrNull(loan.holder_type),
          estimated_due_year: toNumberOrNull(loan.estimated_due_year),
        }
      : null,
  }
}

function mapRecordFact(raw: unknown): DealportRecordFact {
  const item = toRecord(raw)
  const source = toRecordOrNull(item.source)
  const sourceName = toStringOrNull(source?.name)
  return {
    kind: toStringOrNull(item.kind) ?? '',
    value: item.value ?? null,
    low: toNumberOrNull(item.low),
    high: toNumberOrNull(item.high),
    as_of: toStringOrNull(item.as_of),
    basis: toStringOrNull(item.basis),
    source: sourceName
      ? {
          name: sourceName,
          detail: toStringOrNull(source?.detail),
          url: toStringOrNull(source?.url),
        }
      : null,
  }
}

function mapRecordPerson(raw: unknown): DealportRecordPerson {
  const item = toRecord(raw)
  const share = typeof item.share === 'number' || typeof item.share === 'string' ? item.share : null
  return {
    name: toStringOrNull(item.name) ?? '',
    role: toStringOrNull(item.role),
    owner: toBooleanOrNull(item.owner),
    organization: toStringOrNull(item.organization),
    share,
    since: toStringOrNull(item.since),
    phone: toStringOrNull(item.phone),
    email: toStringOrNull(item.email),
    sources: mapStringArray(item.sources),
  }
}

function mapRecordIdentifier(raw: unknown): DealportRecordIdentifier {
  const item = toRecord(raw)
  return {
    type: toStringOrNull(item.type) ?? '',
    values: mapStringArray(item.values),
  }
}

function mapRecordSource(raw: unknown): DealportRecordSource {
  const item = toRecord(raw)
  return {
    name: toStringOrNull(item.name) ?? '',
    url: toStringOrNull(item.url),
    used_for: toStringOrNull(item.used_for),
    latest: toStringOrNull(item.latest),
  }
}

/** Maps a complete Dealport Record from `GET /records/{id}`. */
export function mapDealportRecord(raw: unknown): DealportRecord {
  const item = toRecord(raw)
  const freshness = toRecordOrNull(item.capsule_freshness)
  return {
    id: toStringOrNull(item.id) ?? '',
    kind: toStringOrNull(item.kind) ?? '',
    name: toStringOrNull(item.name) ?? '',
    summary: toStringOrNull(item.summary),
    website: toStringOrNull(item.website),
    phone: toStringOrNull(item.phone),
    facts: toArray(item.facts).map(mapRecordFact),
    people: toArray(item.people).map(mapRecordPerson),
    identifiers: toArray(item.identifiers).map(mapRecordIdentifier),
    sources: toArray(item.sources).map(mapRecordSource),
    capsule_freshness: freshness,
  }
}

/** Maps one matched row from `POST /companies/match`. */
export function mapMatchedCompanyRow(raw: unknown): DealportMatchedCompanyRow {
  const item = toRecord(raw)
  const input = toRecord(item.input)
  const cachedOwner = toRecordOrNull(item.cached_owner)
  const cachedOwnerName = toStringOrNull(cachedOwner?.name)
  return {
    index: toNumberOrNull(item.index) ?? 0,
    external_id: toStringOrNull(item.external_id),
    input: {
      name: toStringOrNull(input.name),
      domain: toStringOrNull(input.domain),
      city: toStringOrNull(input.city),
      state: toStringOrNull(input.state),
    },
    matched: toBooleanOrNull(item.matched) ?? false,
    match_method: toStringOrNull(item.match_method),
    company_id: toStringOrNull(item.company_id),
    company_name: toStringOrNull(item.company_name),
    domain: toStringOrNull(item.domain),
    city: toStringOrNull(item.city),
    state: toStringOrNull(item.state),
    naics: mapStringArray(item.naics),
    industry: toStringOrNull(item.industry),
    cached_owner: cachedOwnerName
      ? {
          name: cachedOwnerName,
          role: toStringOrNull(cachedOwner?.role),
          resolved_at: toStringOrNull(cachedOwner?.resolved_at),
        }
      : null,
    record_url: toStringOrNull(item.record_url),
  }
}

/** Maps the resolved principal summary from `POST /owners`. */
export function mapOwnerPerson(raw: unknown): DealportOwnerPerson | null {
  const item = toRecordOrNull(raw)
  const name = toStringOrNull(item?.name)
  if (!item || !name) return null
  return {
    name,
    role: toStringOrNull(item.role),
    headline: toStringOrNull(item.headline),
    summary: toStringOrNull(item.summary),
    linkedin_url: toStringOrNull(item.linkedin_url),
    photo_url: toStringOrNull(item.photo_url),
    location: toStringOrNull(item.location),
    seniority: toStringOrNull(item.seniority),
    department: toStringOrNull(item.department),
    decision_role: toStringOrNull(item.decision_role),
  }
}

/** Maps a verified phone entry from `POST /owners`. */
export function mapOwnerPhone(raw: unknown): DealportOwnerPhone {
  const item = toRecord(raw)
  return {
    number: toStringOrNull(item.number) ?? '',
    kind: toStringOrNull(item.kind) ?? '',
    label: toStringOrNull(item.label),
    dnc: toStringOrNull(item.dnc),
  }
}

/** Maps an email entry from `POST /owners`. */
export function mapOwnerEmail(raw: unknown): DealportOwnerEmail {
  const item = toRecord(raw)
  return {
    address: toStringOrNull(item.address) ?? '',
    kind: toStringOrNull(item.kind) ?? '',
    verified: toBooleanOrNull(item.verified),
    status: toStringOrNull(item.status),
    checked_at: toStringOrNull(item.checked_at),
  }
}

function mapOwnerRole(raw: unknown): DealportOwnerRole {
  const item = toRecord(raw)
  return {
    title: toStringOrNull(item.title),
    company: toStringOrNull(item.company),
    domain: toStringOrNull(item.domain),
    start: toStringOrNull(item.start),
    end: toStringOrNull(item.end),
    current: toBooleanOrNull(item.current),
  }
}

function mapOwnerEducation(raw: unknown): DealportOwnerEducation {
  const item = toRecord(raw)
  return {
    school: toStringOrNull(item.school) ?? '',
    degree: toStringOrNull(item.degree),
    field: toStringOrNull(item.field),
    start: toStringOrNull(item.start),
    end: toStringOrNull(item.end),
  }
}

/** Maps the professional profile object from `POST /owners`. */
export function mapOwnerProfile(raw: unknown): DealportOwnerProfile | null {
  const item = toRecordOrNull(raw)
  if (!item) return null
  const company = toRecordOrNull(item.company)
  return {
    headline: toStringOrNull(item.headline),
    summary: toStringOrNull(item.summary),
    linkedin_url: toStringOrNull(item.linkedin_url),
    photo_url: toStringOrNull(item.photo_url),
    location: toStringOrNull(item.location),
    seniority: toStringOrNull(item.seniority),
    department: toStringOrNull(item.department),
    decision_role: toStringOrNull(item.decision_role),
    company: company
      ? {
          name: toStringOrNull(company.name),
          domain: toStringOrNull(company.domain),
          industry: toStringOrNull(company.industry),
        }
      : null,
    roles: toArray(item.roles).map(mapOwnerRole),
    education: toArray(item.education).map(mapOwnerEducation),
    skills: mapStringArray(item.skills),
    certifications: mapStringArray(item.certifications),
    languages: mapStringArray(item.languages),
    organizations: mapStringArray(item.organizations),
  }
}
