import type {
  PdlCompanyRecord,
  PdlLocationRecord,
  PdlPersonRecord,
  PdlSchoolRecord,
} from '@/tools/peopledatalabs/types'

/**
 * Build a query string from non-empty params.
 */
export function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const str = String(value)
    if (str.length === 0) continue
    search.append(key, str)
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/**
 * Project a raw PDL person record onto our flat schema.
 */
export function projectPerson(raw: Record<string, unknown> | null | undefined): PdlPersonRecord {
  const r = (raw ?? {}) as Record<string, unknown>
  const location = (r.location ?? {}) as Record<string, unknown>
  return {
    id: (r.id as string) ?? undefined,
    full_name: (r.full_name as string) ?? undefined,
    first_name: (r.first_name as string) ?? undefined,
    last_name: (r.last_name as string) ?? undefined,
    gender: (r.gender as string) ?? undefined,
    birth_year: (r.birth_year as number) ?? undefined,
    linkedin_url: (r.linkedin_url as string) ?? undefined,
    linkedin_username: (r.linkedin_username as string) ?? undefined,
    twitter_url: (r.twitter_url as string) ?? undefined,
    github_url: (r.github_url as string) ?? undefined,
    facebook_url: (r.facebook_url as string) ?? undefined,
    work_email: (r.work_email as string) ?? undefined,
    personal_emails: (r.personal_emails as string[]) ?? undefined,
    emails: (r.emails as unknown[]) ?? undefined,
    phone_numbers: (r.phone_numbers as string[]) ?? undefined,
    mobile_phone: (r.mobile_phone as string) ?? undefined,
    job_title: (r.job_title as string) ?? undefined,
    job_title_role: (r.job_title_role as string) ?? undefined,
    job_title_sub_role: (r.job_title_sub_role as string) ?? undefined,
    job_title_levels: (r.job_title_levels as string[]) ?? undefined,
    job_company_name: (r.job_company_name as string) ?? undefined,
    job_company_website: (r.job_company_website as string) ?? undefined,
    job_company_industry: (r.job_company_industry as string) ?? undefined,
    job_company_size: (r.job_company_size as string) ?? undefined,
    job_company_linkedin_url: (r.job_company_linkedin_url as string) ?? undefined,
    job_start_date: (r.job_start_date as string) ?? undefined,
    location_name: (r.location_name as string) ?? (location.name as string) ?? undefined,
    location_locality:
      (r.location_locality as string) ?? (location.locality as string) ?? undefined,
    location_region: (r.location_region as string) ?? (location.region as string) ?? undefined,
    location_country: (r.location_country as string) ?? (location.country as string) ?? undefined,
    location_continent:
      (r.location_continent as string) ?? (location.continent as string) ?? undefined,
    industry: (r.industry as string) ?? undefined,
    skills: (r.skills as string[]) ?? undefined,
    interests: (r.interests as string[]) ?? undefined,
    experience: (r.experience as unknown[]) ?? undefined,
    education: (r.education as unknown[]) ?? undefined,
  }
}

/**
 * Project a raw PDL company record onto our flat schema.
 */
export function projectCompany(raw: Record<string, unknown> | null | undefined): PdlCompanyRecord {
  const r = (raw ?? {}) as Record<string, unknown>
  const location = (r.location ?? {}) as Record<string, unknown>
  return {
    id: (r.id as string) ?? undefined,
    name: (r.name as string) ?? undefined,
    display_name: (r.display_name as string) ?? undefined,
    website: (r.website as string) ?? undefined,
    ticker: (r.ticker as string) ?? undefined,
    type: (r.type as string) ?? undefined,
    industry: (r.industry as string) ?? undefined,
    size: (r.size as string) ?? undefined,
    employee_count: (r.employee_count as number) ?? undefined,
    founded: (r.founded as number) ?? undefined,
    headline: (r.headline as string) ?? undefined,
    summary: (r.summary as string) ?? undefined,
    linkedin_url: (r.linkedin_url as string) ?? undefined,
    linkedin_id: (r.linkedin_id as string) ?? undefined,
    twitter_url: (r.twitter_url as string) ?? undefined,
    facebook_url: (r.facebook_url as string) ?? undefined,
    location_name: (r.location_name as string) ?? (location.name as string) ?? undefined,
    location_locality:
      (r.location_locality as string) ?? (location.locality as string) ?? undefined,
    location_region: (r.location_region as string) ?? (location.region as string) ?? undefined,
    location_country: (r.location_country as string) ?? (location.country as string) ?? undefined,
    tags: (r.tags as string[]) ?? undefined,
    tickers: (r.tickers as string[]) ?? undefined,
  }
}

/**
 * Project a raw PDL location record onto our flat schema.
 */
export function projectLocation(
  raw: Record<string, unknown> | null | undefined
): PdlLocationRecord {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    name: (r.name as string) ?? undefined,
    locality: (r.locality as string) ?? undefined,
    region: (r.region as string) ?? undefined,
    subregion: (r.subregion as string) ?? undefined,
    country: (r.country as string) ?? undefined,
    continent: (r.continent as string) ?? undefined,
    type: (r.type as string) ?? undefined,
    geo: (r.geo as string) ?? undefined,
  }
}

/**
 * Project a raw PDL school record onto our flat schema.
 */
export function projectSchool(raw: Record<string, unknown> | null | undefined): PdlSchoolRecord {
  const r = (raw ?? {}) as Record<string, unknown>
  const location = (r.location ?? {}) as Record<string, unknown>
  return {
    id: (r.id as string) ?? undefined,
    name: (r.name as string) ?? undefined,
    type: (r.type as string) ?? undefined,
    website: (r.website as string) ?? undefined,
    linkedin_url: (r.linkedin_url as string) ?? undefined,
    linkedin_id: (r.linkedin_id as string) ?? undefined,
    facebook_url: (r.facebook_url as string) ?? undefined,
    twitter_url: (r.twitter_url as string) ?? undefined,
    domain: (r.domain as string) ?? undefined,
    location_name: (r.location_name as string) ?? (location.name as string) ?? undefined,
    location_locality:
      (r.location_locality as string) ?? (location.locality as string) ?? undefined,
    location_region: (r.location_region as string) ?? (location.region as string) ?? undefined,
    location_country: (r.location_country as string) ?? (location.country as string) ?? undefined,
    location_continent:
      (r.location_continent as string) ?? (location.continent as string) ?? undefined,
  }
}
