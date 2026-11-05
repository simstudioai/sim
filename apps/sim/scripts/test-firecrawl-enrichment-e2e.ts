import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { companyDomainEnrichment } from '@/enrichments/company-domain'
import { companyInfoEnrichment } from '@/enrichments/company-info'
import { linkedinProfileEnrichment } from '@/enrichments/linkedin-profile'
import { phoneNumberEnrichment } from '@/enrichments/phone-number'
import type { EnrichmentConfig } from '@/enrichments/types'
import { workEmailEnrichment } from '@/enrichments/work-email'
import { firecrawlEnrichTool } from '@/tools/firecrawl/enrich'
import type { FirecrawlEnrichParams } from '@/tools/firecrawl/types'

const logger = createLogger('FirecrawlEnrichmentE2E')

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Set ${name} before running the live enrichment checks`)
  return value
}

const reportPath = requiredEnv('FIRECRAWL_ENRICHMENT_REPORT_PATH')
const apiKey = requiredEnv('FIRECRAWL_API_KEY')
const person = {
  fullName: requiredEnv('FIRECRAWL_TEST_FULL_NAME'),
  companyDomain: requiredEnv('FIRECRAWL_TEST_EMPLOYER_DOMAIN'),
  linkedinUrl: requiredEnv('FIRECRAWL_TEST_LINKEDIN_URL'),
  email: requiredEnv('FIRECRAWL_TEST_EMAIL'),
}
const profileUrl = new URL(
  /^https?:\/\//i.test(person.linkedinUrl)
    ? person.linkedinUrl
    : `https://${person.linkedinUrl.replace(/^\/+/, '')}`
)
const [profileKind, profileSlug] = profileUrl.pathname.split('/').filter(Boolean)
assert.match(profileUrl.hostname, /(^|\.)linkedin\.com$/i)
assert.equal(profileKind?.toLowerCase(), 'in')
assert.ok(profileSlug)
const expectedLinkedinUrl = `https://www.linkedin.com/in/${profileSlug}`

interface LiveCheck {
  name: string
  config: EnrichmentConfig
  inputs: Record<string, string>
  verify?: (output: Record<string, unknown>) => void
  expectNoMatch?: boolean
}

const checks: LiveCheck[] = [
  {
    name: 'single-part-name email lookup returns a clean miss',
    config: workEmailEnrichment,
    inputs: { fullName: 'AlexandriaNoMatchFixture', companyDomain: 'example.com' },
    expectNoMatch: true,
  },
  {
    name: 'single-part-name phone lookup returns a clean miss',
    config: phoneNumberEnrichment,
    inputs: { fullName: 'AlexandriaNoMatchFixture', companyDomain: 'example.com' },
    expectNoMatch: true,
  },
  {
    name: 'work email from name and company',
    config: workEmailEnrichment,
    inputs: { fullName: person.fullName, companyDomain: person.companyDomain },
    verify: (output) =>
      assert.equal(String(output.email).toLowerCase(), person.email.toLowerCase()),
  },
  {
    name: 'mobile from LinkedIn',
    config: phoneNumberEnrichment,
    inputs: { fullName: person.fullName, linkedinUrl: person.linkedinUrl },
    verify: (output) => assert.match(String(output.phone), /^\+?[\d\s()-]{7,}$/),
  },
  {
    name: 'LinkedIn from email',
    config: linkedinProfileEnrichment,
    inputs: { fullName: person.fullName, email: person.email },
    verify: (output) => assert.equal(output.linkedinUrl, expectedLinkedinUrl),
  },
  {
    name: 'LinkedIn from name and company',
    config: linkedinProfileEnrichment,
    inputs: { fullName: person.fullName, companyDomain: person.companyDomain },
    verify: (output) => assert.equal(output.linkedinUrl, expectedLinkedinUrl),
  },
  {
    name: 'company information',
    config: companyInfoEnrichment,
    inputs: { domain: 'stripe.com' },
    verify: (output) => {
      assert.ok(output.employeeCount)
      assert.ok(output.description)
    },
  },
  {
    name: 'company domain from name',
    config: companyDomainEnrichment,
    inputs: { companyName: 'Stripe' },
    verify: (output) => assert.equal(output.domain, 'stripe.com'),
  },
]

const results: Array<{
  name: string
  status: string
  durationMs: number
  creditsUsed?: number
  costUsd?: number
  error?: string
}> = []
const transform = firecrawlEnrichTool.transformResponse
const pricing = firecrawlEnrichTool.hosting?.pricing
assert.ok(transform)
assert.equal(pricing?.type, 'custom')

try {
  for (const check of checks) {
    const start = performance.now()
    try {
      const provider = check.config.providers[0]
      assert.ok(provider)
      const built = provider.buildParams(check.inputs)
      assert.ok(built, 'Fixture did not provide usable identifiers')
      const params = { ...built, apiKey } as FirecrawlEnrichParams
      const request = firecrawlEnrichTool.request
      assert.equal(typeof request.url, 'string')
      assert.ok(request.body)
      // boundary-raw-fetch: live test exercises the external provider using the production request configuration.
      const response = await fetch(String(request.url), {
        method: 'POST',
        headers: request.headers?.(params),
        body: JSON.stringify(request.body(params)),
        signal: AbortSignal.timeout(180_000),
      })
      const result = await transform(response, params)
      if (check.expectNoMatch) {
        assert.equal(result.success, false)
        const failure = provider.projectFailure({
          error: result.error ?? 'Lookup failed',
          output: result.output,
        })
        assert.equal(failure.status, 'no_match')
        assert.equal(result.output.creditsUsed, 0)
      } else {
        assert.ok(result.success, result.error)
        const mapped = provider.mapOutput(result.output)
        assert.ok(mapped, 'Expected a matching record')
        assert.ok(check.verify)
        check.verify(mapped)
      }
      assert.ok(Number.isFinite(result.output.creditsUsed))
      assert.equal(pricing?.type, 'custom')
      const cost = pricing?.type === 'custom' ? pricing.getCost(params, result.output) : undefined
      results.push({
        name: check.name,
        status: 'passed',
        durationMs: performance.now() - start,
        creditsUsed: result.output.creditsUsed,
        costUsd: typeof cost === 'number' ? cost : cost?.cost,
      })
      logger.info('Live enrichment check passed', {
        name: check.name,
        creditsUsed: result.output.creditsUsed,
      })
    } catch (error) {
      results.push({
        name: check.name,
        status: 'failed',
        durationMs: performance.now() - start,
        error: getErrorMessage(error).replaceAll(apiKey, '[REDACTED]'),
      })
      logger.error('Live enrichment check failed', { name: check.name })
    }
  }
} finally {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
    { mode: 0o600 }
  )
}

if (results.some((result) => result.status !== 'passed')) process.exitCode = 1
