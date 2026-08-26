/**
 * Shared request building and CSV decoding for the Semrush SEO (Analytics) API.
 *
 * Every report endpoint answers with a delimited CSV body whose first line is a
 * header. The API returns the requested `export_columns` in the order they were
 * asked for, but it does not guarantee to return all of them — `phrase_these`,
 * for example, accepts `Td` and then omits the Trends column from the response.
 * Decoding by position would silently shift every later field onto the wrong
 * key, so each header cell is matched back to the column it was requested as.
 */

/** Report endpoints under Domain, Subdomain, Keyword, URL, and Overview analytics. */
export const SEMRUSH_ANALYTICS_URL = 'https://api.semrush.com/'

/** Backlink Analytics reports live on their own path and use snake_case columns. */
export const SEMRUSH_BACKLINKS_URL = 'https://api.semrush.com/analytics/v1/'

/**
 * Rows a single report call may return. The API itself allows far more on some
 * endpoints (up to 4,000,000 on URL reports), but a workflow step holds its
 * whole result in memory, so the ceiling is deliberately lower than the API's.
 */
export const SEMRUSH_MAX_ROWS = 100000

type SemrushValueType = 'string' | 'number' | 'numberList'

interface SemrushColumnDef {
  key: string
  type: SemrushValueType
  /** Header labels this column is known to render as, lowercased. */
  labels: string[]
}

function column(key: string, type: SemrushValueType, ...labels: string[]): SemrushColumnDef {
  return { key, type, labels: labels.map((label) => label.toLowerCase()) }
}

/**
 * Analytics column codes and the header labels they render as, both taken from
 * https://developer.semrush.com/api/v3/analytics/. A column with more than one
 * label renders differently across reports: `Tc` is `Traffic Cost (%)` in
 * `domain_organic` and `Traffic Cost` in `domain_adwords`.
 */
const ANALYTICS_COLUMNS: Record<string, SemrushColumnDef> = {
  Ac: column('paidCost', 'number', 'Adwords Cost'),
  Ad: column('paidKeywords', 'number', 'Adwords Keywords'),
  Am: column('paidKeywordsDifference', 'number', 'Adwords Keywords Difference'),
  At: column('paidTraffic', 'number', 'Adwords Traffic'),
  Bm: column('paidTrafficDifference', 'number', 'Adwords Traffic Difference'),
  Cm: column('paidCostDifference', 'number', 'Adwords Cost Difference'),
  Co: column('competition', 'number', 'Competition'),
  Cp: column('cpc', 'number', 'CPC'),
  Cr: column('competitorRelevance', 'number', 'Competitor Relevance'),
  Db: column('database', 'string', 'Database'),
  Dn: column('domain', 'string', 'Domain'),
  Ds: column('description', 'string', 'Description'),
  Dt: column('date', 'string', 'Date'),
  Fk: column('keywordSerpFeatures', 'numberList', 'Keywords SERP Features', 'SERP Features'),
  Fp: column('serpFeatures', 'numberList', 'SERP Features'),
  In: column('intents', 'numberList', 'Intents', 'Intent'),
  Kd: column('keywordDifficulty', 'number', 'Keyword Difficulty Index', 'Keyword Difficulty'),
  Np: column('commonKeywords', 'number', 'Common Keywords'),
  Nq: column('searchVolume', 'number', 'Search Volume'),
  Nr: column('numberOfResults', 'number', 'Number of Results'),
  Oc: column('organicCost', 'number', 'Organic Cost'),
  Om: column('organicKeywordsDifference', 'number', 'Organic Keywords Difference'),
  Or: column('organicKeywords', 'number', 'Organic Keywords'),
  Ot: column('organicTraffic', 'number', 'Organic Traffic'),
  Pc: column('numberOfKeywords', 'number', 'Number of Keywords'),
  Pd: column('positionDifference', 'number', 'Position Difference'),
  Ph: column('keyword', 'string', 'Keyword'),
  Po: column('position', 'number', 'Position'),
  Pp: column('previousPosition', 'number', 'Previous Position'),
  Pr: column('productPrice', 'number', 'Product Price'),
  Pt: column('positionType', 'string', 'Position type'),
  Rk: column('rank', 'number', 'Rank'),
  Rr: column('relatedRelevance', 'number', 'Related Relevance'),
  Sh: column('plaKeywords', 'number', 'PLA keywords'),
  Sn: column('shopName', 'string', 'Shop Name'),
  Sv: column('plaUniques', 'number', 'PLA uniques'),
  Tc: column('trafficCost', 'number', 'Traffic Cost (%)', 'Traffic Cost'),
  Td: column('trends', 'numberList', 'Trends'),
  Tg: column('traffic', 'number', 'Traffic'),
  Tm: column('organicTrafficDifference', 'number', 'Organic Traffic Difference'),
  Tr: column('trafficPercent', 'number', 'Traffic (%)'),
  Ts: column('timestamp', 'number', 'Timestamp'),
  Tt: column('title', 'string', 'Title'),
  Um: column('organicCostDifference', 'number', 'Organic Cost Difference'),
  Un: column('adId', 'string', 'Ad id'),
  Ur: column('url', 'string', 'Url'),
  Vu: column('visibleUrl', 'string', 'Visible Url'),
}

/**
 * Backlink Analytics columns, documented at
 * https://developer.semrush.com/api/v3/analytics/backlinks/. These reports echo
 * the column name itself as the header, so the code doubles as the label.
 */
const BACKLINK_COLUMNS: Record<string, SemrushColumnDef> = {
  anchor: column('anchor', 'string'),
  ascore: column('authorityScore', 'number'),
  backlinks_num: column('backlinksNum', 'number'),
  common_refdomains: column('commonRefdomains', 'number'),
  country: column('country', 'string'),
  domain: column('domain', 'string'),
  domain_ascore: column('domainAuthorityScore', 'number'),
  domains_num: column('domainsNum', 'number'),
  external_num: column('externalLinksNum', 'number'),
  first_seen: column('firstSeen', 'number'),
  follows_num: column('followsNum', 'number'),
  forms_num: column('formsNum', 'number'),
  frames_num: column('framesNum', 'number'),
  images_num: column('imagesNum', 'number'),
  internal_num: column('internalLinksNum', 'number'),
  ip: column('ip', 'string'),
  ipclassc_num: column('ipClassCNum', 'number'),
  ips_num: column('ipsNum', 'number'),
  last_seen: column('lastSeen', 'number'),
  neighbour: column('domain', 'string'),
  nofollow: column('nofollow', 'string'),
  nofollows_num: column('nofollowsNum', 'number'),
  page_ascore: column('pageAuthorityScore', 'number'),
  response_code: column('responseCode', 'number'),
  similarity: column('similarity', 'number'),
  source_title: column('sourceTitle', 'string'),
  source_url: column('sourceUrl', 'string'),
  sponsored_num: column('sponsoredNum', 'number'),
  target_url: column('targetUrl', 'string'),
  texts_num: column('textsNum', 'number'),
  total: column('total', 'number'),
  ugc_num: column('ugcNum', 'number'),
  urls_num: column('urlsNum', 'number'),
  zone: column('zone', 'string'),
}

const COLUMN_DEFS: Record<string, SemrushColumnDef> = {
  ...ANALYTICS_COLUMNS,
  ...BACKLINK_COLUMNS,
}

/** Resolves a column code, treating the code itself as an accepted header label. */
export function getColumnDef(code: string): SemrushColumnDef {
  const def = COLUMN_DEFS[code]
  if (!def) throw new Error(`Unknown Semrush export column: ${code}`)
  return def
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Splits one CSV line, honouring the quoting that `export_escape=1` applies so
 * that titles, anchors, and ad copy containing the delimiter survive.
 */
function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"' && current === '') {
      quoted = true
    } else if (char === delimiter) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

/** Reports are semicolon-delimited, but the header settles it for each body. */
function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length
  const commas = (headerLine.match(/,/g) ?? []).length
  return commas > semicolons ? ',' : ';'
}

function coerce(raw: string, type: SemrushValueType): string | number | number[] | null {
  const value = raw.trim()
  if (value === '') return type === 'numberList' ? [] : null
  if (type === 'string') return value
  if (type === 'numberList') {
    return value
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry))
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The SEO API answers a rejected request with HTTP 200 and a plain-text body of
 * the form `ERROR 132 :: API UNITS BALANCE IS ZERO`, so the body has to be
 * inspected even on a successful status.
 */
function assertNoApiError(body: string): void {
  if (/^ERROR\b/i.test(body.trimStart())) {
    throw new Error(`Semrush API error: ${body.trim().split('\n')[0]}`)
  }
}

async function readReportBody(response: Response): Promise<string[]> {
  const body = await response.text()

  if (!response.ok) {
    throw new Error(body.trim() || `Semrush request failed with status ${response.status}`)
  }
  assertNoApiError(body)

  return body.split('\n').filter((line) => line.trim() !== '')
}

/**
 * Matches each header cell back to the column it was requested as.
 *
 * The walk is greedy and left to right over the requested codes, which is what
 * disambiguates the labels two columns share: `Fk` and `Fp` both render as
 * `SERP Features`, and only their request order tells them apart. A cell whose
 * label is not recognised falls back to its positional column, but only when
 * the response returned exactly as many columns as were asked for — otherwise
 * something was dropped and position no longer means anything.
 */
function resolveHeader(
  headerCells: string[],
  columnCodes: readonly string[]
): (SemrushColumnDef | null)[] {
  const defs = columnCodes.map(getColumnDef)
  const sameLength = headerCells.length === defs.length
  const resolved: (SemrushColumnDef | null)[] = []
  let cursor = 0

  for (const [index, cell] of headerCells.entries()) {
    const label = normalizeLabel(cell)
    let matched: SemrushColumnDef | null = null

    for (let position = cursor; position < defs.length; position++) {
      const code = columnCodes[position]
      if (code.toLowerCase() === label || defs[position].labels.includes(label)) {
        matched = defs[position]
        cursor = position + 1
        break
      }
    }
    resolved.push(matched ?? (sameLength ? defs[index] : null))
  }
  return resolved
}

/** Reads a report body and maps each data line onto the requested column keys. */
export async function readSemrushReport<T>(
  response: Response,
  columnCodes: readonly string[]
): Promise<T[]> {
  const lines = await readReportBody(response)
  if (lines.length === 0) return []

  const delimiter = detectDelimiter(lines[0])
  const columns = resolveHeader(splitCsvLine(lines[0], delimiter), columnCodes)

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter)
    const row: Record<string, unknown> = {}
    columns.forEach((def, index) => {
      if (!def) return
      row[def.key] = coerce(values[index] ?? '', def.type)
    })
    return row as T
  })
}

/**
 * Reads a report whose columns are named after the targets being compared, so
 * the header itself carries data (Domain vs. Domain positions).
 */
export async function readSemrushReportWithHeader(
  response: Response
): Promise<{ headers: string[]; rows: string[][] }> {
  const lines = await readReportBody(response)
  if (lines.length === 0) return { headers: [], rows: [] }

  const delimiter = detectDelimiter(lines[0])
  return {
    headers: splitCsvLine(lines[0], delimiter).map((header) => header.trim()),
    rows: lines.slice(1).map((line) => splitCsvLine(line, delimiter)),
  }
}

export interface SemrushQuery {
  apiKey: string
  type: string
  columnCodes: readonly string[]
  extra?: Record<string, string | number | undefined | null>
}

/** Builds a report URL with the shared `key`/`type`/`export_columns` triple. */
export function buildSemrushUrl(baseUrl: string, query: SemrushQuery): string {
  const url = new URL(baseUrl)
  url.searchParams.set('key', query.apiKey)
  url.searchParams.set('type', query.type)
  url.searchParams.set('export_columns', query.columnCodes.join(','))
  url.searchParams.set('export_escape', '1')

  for (const [name, value] of Object.entries(query.extra ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(name, String(value))
  }
  return url.toString()
}

/**
 * Clamps a user- or model-supplied row limit to the range a workflow can hold.
 *
 * A positive fraction floors to zero, and `display_limit=0` is a different
 * request from the one the caller asked for, so the floor is held at one row.
 */
export function normalizeLimit(limit: number | string | undefined, fallback: number): number {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), SEMRUSH_MAX_ROWS)
}
