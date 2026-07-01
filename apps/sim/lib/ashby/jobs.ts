import { createLogger } from '@sim/logger'
import { z } from 'zod'

const logger = createLogger('AshbyJobs')

/**
 * The Ashby-hosted job board slug for Sim — the final path segment of
 * `https://jobs.ashbyhq.com/sim`. Drives the public, no-auth job posting API.
 */
const ASHBY_JOB_BOARD_NAME = 'sim'

/** Public job posting API — returns every listed posting in one payload, no auth. */
const ASHBY_JOB_BOARD_URL = `https://api.ashbyhq.com/posting-api/job-board/${ASHBY_JOB_BOARD_NAME}?includeCompensation=true`

/** Revalidate the board hourly, shared across every render (build/revalidate-time cache). */
const REVALIDATE_SECONDS = 3600

/**
 * Tolerant schema for a single Ashby posting. The public board omits several
 * fields depending on the posting, so everything beyond the identity/title is
 * optional or nullable — Ashby is a third party and its payload varies per board.
 */
const ashbyPostingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    department: z.string().nullish(),
    team: z.string().nullish(),
    location: z.string().nullish(),
    employmentType: z.string().nullish(),
    workplaceType: z.string().nullish(),
    isListed: z.boolean().nullish(),
    isRemote: z.boolean().nullish(),
    publishedAt: z.string().nullish(),
    jobUrl: z.string(),
    applyUrl: z.string().nullish(),
    shouldDisplayCompensationOnJobPostings: z.boolean().nullish(),
    compensation: z
      .object({
        compensationTierSummary: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough()

const ashbyJobBoardSchema = z.object({
  apiVersion: z.string().nullish(),
  jobs: z.array(ashbyPostingSchema),
})

/** Human-friendly labels for Ashby's enum-ish string fields. */
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FullTime: 'Full-time',
  PartTime: 'Part-time',
  Intern: 'Internship',
  Contract: 'Contract',
  Temporary: 'Temporary',
}

const WORKPLACE_TYPE_LABELS: Record<string, string> = {
  OnSite: 'On-site',
  Remote: 'Remote',
  Hybrid: 'Hybrid',
}

/** A normalized, presentation-ready job posting for the careers page. */
export interface CareerPosting {
  id: string
  title: string
  /** Grouping bucket — the posting's department (falls back to team, then "Other"). */
  department: string
  /** Display location, e.g. "San Francisco" or "Remote". */
  location: string
  /** Human employment type, e.g. "Full-time". Empty string when unknown. */
  employmentType: string
  /** Human workplace type, e.g. "On-site". Empty string when unknown. */
  workplaceType: string
  /** Compensation range summary when the posting opts to display it, else null. */
  compensationSummary: string | null
  /** Public detail URL on `jobs.ashbyhq.com`. */
  jobUrl: string
}

/**
 * Fetches the listed Sim job postings from Ashby's public job board API and
 * normalizes them for the careers page. Cached at build/revalidate time and
 * shared across renders. Mirrors {@link getGitHubStars}: it never throws — on any
 * transport, status, or shape error it logs a warning and returns an empty list
 * so the page renders its "no open roles" state instead of erroring.
 */
export async function getAshbyJobs(): Promise<CareerPosting[]> {
  try {
    const response = await fetch(ASHBY_JOB_BOARD_URL, {
      headers: { Accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
      cache: 'force-cache',
    })

    if (!response.ok) {
      logger.warn('Ashby job board request failed', { status: response.status })
      return []
    }

    const parsed = ashbyJobBoardSchema.safeParse(await response.json())
    if (!parsed.success) {
      logger.warn('Ashby job board response failed validation', { issues: parsed.error.issues })
      return []
    }

    return parsed.data.jobs
      .filter((job) => job.isListed !== false)
      .map(normalizePosting)
      .sort(comparePostings)
  } catch (error) {
    logger.warn('Ashby job board request threw', { error })
    return []
  }
}

/** Maps a raw Ashby posting to the presentation-ready {@link CareerPosting} shape. */
function normalizePosting(job: z.infer<typeof ashbyPostingSchema>): CareerPosting {
  const employmentType = job.employmentType
    ? (EMPLOYMENT_TYPE_LABELS[job.employmentType] ?? job.employmentType)
    : ''
  const workplaceType = job.workplaceType
    ? (WORKPLACE_TYPE_LABELS[job.workplaceType] ?? job.workplaceType)
    : ''
  const location = job.location?.trim() || (job.isRemote ? 'Remote' : '')
  const compensationSummary =
    job.shouldDisplayCompensationOnJobPostings && job.compensation?.compensationTierSummary
      ? job.compensation.compensationTierSummary
      : null

  return {
    id: job.id,
    title: job.title,
    department: job.department?.trim() || job.team?.trim() || 'Other',
    location,
    employmentType,
    workplaceType,
    compensationSummary,
    jobUrl: job.jobUrl,
  }
}

/** Orders postings by department, then title — the render order and grouping key. */
function comparePostings(a: CareerPosting, b: CareerPosting): number {
  return a.department.localeCompare(b.department) || a.title.localeCompare(b.title)
}
