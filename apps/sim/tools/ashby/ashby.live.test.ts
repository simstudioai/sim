/**
 * Live verification of the Ashby connector against a real Ashby organization.
 *
 * Skipped unless `ASHBY_LIVE=1` and `ASHBY_API_KEY` are set, so it is inert in
 * CI and for anyone without credentials. Writes are gated separately behind
 * `ASHBY_LIVE_WRITES=1` because every Ashby call is a production write - there
 * is no sandbox, no test mode, and no dry-run flag.
 *
 *   Read-only:  ASHBY_LIVE=1 ASHBY_API_KEY=... bunx vitest run tools/ashby/ashby.live.test.ts
 *   With writes: add ASHBY_LIVE_WRITES=1 ASHBY_FIXTURE_JOB_ID=<uuid>
 *
 * The Ashby tools have a static URL, pure `headers(params)`/`body(params)`, and
 * a `transformResponse(Response)` with no postProcess or execution context, so
 * driving them directly here reproduces exactly what `executeTool` does.
 *
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { anonymizeCandidateTool } from '@/tools/ashby/anonymize_candidate'
import { changeApplicationSourceTool } from '@/tools/ashby/change_application_source'
import { createApplicationTool } from '@/tools/ashby/create_application'
import { createCandidateTool } from '@/tools/ashby/create_candidate'
import { deleteApplicationTool } from '@/tools/ashby/delete_application'
import { getApplicationTool } from '@/tools/ashby/get_application'
import { getCandidateTool } from '@/tools/ashby/get_candidate'
import { listCustomFieldsTool } from '@/tools/ashby/list_custom_fields'
import { listJobPostingsTool } from '@/tools/ashby/list_job_postings'
import { listJobsTool } from '@/tools/ashby/list_jobs'
import { listSourcesTool } from '@/tools/ashby/list_sources'
import { setCustomFieldValueTool } from '@/tools/ashby/set_custom_field_value'
import { setCustomFieldValuesTool } from '@/tools/ashby/set_custom_field_values'
import type { ToolConfig } from '@/tools/types'

const LIVE = process.env.ASHBY_LIVE === '1' && Boolean(process.env.ASHBY_API_KEY)
const WRITES = LIVE && process.env.ASHBY_LIVE_WRITES === '1'
const apiKey = process.env.ASHBY_API_KEY ?? ''

/** Live API calls with pagination comfortably exceed the 10s default. */
const TIMEOUT = 120_000

type AnyTool = ToolConfig<never, never>

/** Drive a tool exactly as executeTool does for this family: build, fetch, transform. */
async function call(tool: AnyTool, params: Record<string, unknown>): Promise<Record<string, any>> {
  const request = tool.request
  if (!request) throw new Error(`${tool.id} has no request config`)
  const url = typeof request.url === 'function' ? request.url(params as never) : request.url
  const headers = request.headers ? request.headers(params as never) : {}
  const buildBody = request.body as ((p: unknown) => unknown) | undefined
  const response = await fetch(url as string, {
    method: (request.method as string) ?? 'POST',
    headers: headers as Record<string, string>,
    body: buildBody ? JSON.stringify(buildBody(params)) : undefined,
  })
  const transform = tool.transformResponse as (r: Response, p?: unknown) => Promise<any>
  const result = await transform(response, params)
  return result.output
}

/** Report a finding to stdout so the run doubles as a readable verification log. */
function note(label: string, value: unknown) {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  console.info(`  [live] ${label}: ${rendered}`)
}

/** Facts discovered in the read-only phase and reused by the write phase. */
const discovered: {
  syncToken?: string | null
  fullScanJobCount?: number
  candidateFieldId?: string
  candidateFieldType?: string
  candidateFieldOptions?: string[]
  hasCandidatesDelete?: boolean
} = {}

/**
 * `vitest.setup.ts` calls `setupGlobalFetchMock()`, which does
 * `vi.stubGlobal('fetch', ...)` for every test file in the app. Without
 * restoring the real implementation, every request below would quietly hit the
 * mock and the whole suite would be a false pass - so restore it, then assert
 * the restore actually worked.
 */
function useRealFetch() {
  vi.unstubAllGlobals()
  expect(vi.isMockFunction(globalThis.fetch)).toBe(false)
}

describe.skipIf(!LIVE)('ashby live (read-only)', () => {
  beforeAll(useRealFetch)

  it(
    'probes candidatesDelete without creating anything',
    async () => {
      // application.delete against a random UUID has no side effects and
      // distinguishes a missing scope from a missing record. This runs before
      // any fixture exists so we never create an application we cannot delete.
      let message = ''
      try {
        await call(deleteApplicationTool, {
          apiKey,
          applicationId: '00000000-0000-4000-8000-000000000000',
        })
        message = '(unexpectedly succeeded)'
      } catch (error) {
        message = (error as Error).message
      }
      note('delete scope probe error', message)
      // Whatever Ashby returns, our error extraction must render it readably.
      expect(message).not.toContain('[object Object]')
      discovered.hasCandidatesDelete = !/permission/i.test(message)
      note('candidatesDelete present', discovered.hasCandidatesDelete)
    },
    TIMEOUT
  )

  it(
    'probes candidatesWrite without creating anything',
    async () => {
      // Same zero-side-effect trick: a random UUID cannot exist, so a
      // permission error and a not-found error are cleanly distinguishable.
      const probe = async (fn: () => Promise<unknown>) => {
        try {
          await fn()
          return '(unexpectedly succeeded)'
        } catch (error) {
          return (error as Error).message
        }
      }
      const random = '00000000-0000-4000-8000-000000000000'

      const anonymizeError = await probe(() =>
        call(anonymizeCandidateTool, { apiKey, candidateId: random })
      )
      const setValueError = await probe(() =>
        call(setCustomFieldValueTool, {
          apiKey,
          objectId: random,
          objectType: 'Candidate',
          fieldId: random,
          fieldValue: null,
        })
      )
      note('anonymize probe error', anonymizeError)
      note('setValue probe error', setValueError)
      note('candidatesWrite present', !/permission/i.test(anonymizeError))

      expect(anonymizeError).not.toContain('[object Object]')
      expect(setValueError).not.toContain('[object Object]')
    },
    TIMEOUT
  )

  it(
    'returns a syncToken only on the last page',
    async () => {
      // The core P0 claim, asserted in both our docs and the param description
      // but never checked against the API.
      let cursor: string | undefined
      let page = 0
      let total = 0
      let lastPageToken: string | null = null
      const midPageTokens: Array<string | null> = []

      do {
        const output = await call(listJobsTool, { apiKey, perPage: 5, cursor })
        page += 1
        total += output.jobs.length
        if (output.moreDataAvailable) {
          midPageTokens.push(output.nextSyncCursor)
          cursor = output.nextCursor
        } else {
          lastPageToken = output.nextSyncCursor
          cursor = undefined
        }
        expect(page).toBeLessThan(60)
      } while (cursor)

      note('pages walked', page)
      note('jobs seen', total)
      note('syncToken on non-final pages', midPageTokens)
      note('syncToken on final page', lastPageToken ? 'present' : 'absent')

      for (const token of midPageTokens) expect(token).toBeNull()
      discovered.syncToken = lastPageToken
      discovered.fullScanJobCount = total
    },
    TIMEOUT
  )

  it(
    'replays the syncToken for an incremental scan',
    async () => {
      if (!discovered.syncToken) {
        note('incremental replay', 'SKIPPED - no syncToken was returned')
        return
      }
      const output = await call(listJobsTool, { apiKey, syncToken: discovered.syncToken })
      note('full scan job count', discovered.fullScanJobCount)
      note('incremental job count', output.jobs.length)
      note('incremental syncToken', output.nextSyncCursor ? 'present' : 'absent')
      expect(output.jobs.length).toBeLessThanOrEqual(discovered.fullScanJobCount ?? 0)
    },
    TIMEOUT
  )

  it(
    'exposes confidential as a boolean on every job',
    async () => {
      const output = await call(listJobsTool, { apiKey, perPage: 100 })
      expect(output.jobs.length).toBeGreaterThan(0)
      for (const job of output.jobs) expect(typeof job.confidential).toBe('boolean')
      const confidential = output.jobs.filter((j: { confidential: boolean }) => j.confidential)
      note('jobs sampled', output.jobs.length)
      note('confidential jobs visible to this key', confidential.length)
    },
    TIMEOUT
  )

  it(
    'includes draft postings only when asked',
    async () => {
      const withoutDrafts = await call(listJobPostingsTool, { apiKey })
      const withDrafts = await call(listJobPostingsTool, {
        apiKey,
        includeUnpublishedJobPostings: true,
      })
      const baseIds = new Set(withoutDrafts.jobPostings.map((p: { id: string }) => p.id))
      const extra = withDrafts.jobPostings.filter((p: { id: string }) => !baseIds.has(p.id))
      const statuses = [...new Set(withDrafts.jobPostings.map((p: { status: string }) => p.status))]

      note('postings without drafts', withoutDrafts.jobPostings.length)
      note('postings with drafts', withDrafts.jobPostings.length)
      note('postings added by the flag', extra.length)
      note('statuses seen', statuses)

      // Superset, never a different set.
      for (const id of baseIds) {
        expect(withDrafts.jobPostings.some((p: { id: string }) => p.id === id)).toBe(true)
      }
      expect(withDrafts.jobPostings.length).toBeGreaterThanOrEqual(withoutDrafts.jobPostings.length)
    },
    TIMEOUT
  )

  it(
    'finds a Candidate-scoped custom field to write to',
    async () => {
      const output = await call(listCustomFieldsTool, { apiKey, perPage: 100 })
      const candidateFields = output.customFields.filter(
        (f: { objectType: string; isArchived: boolean; isRequired: boolean }) =>
          f.objectType === 'Candidate' && !f.isArchived && !f.isRequired
      )
      note('candidate custom fields available', candidateFields.length)
      note(
        'candidate fields',
        candidateFields.map(
          (f: { title: string; fieldType: string }) => `${f.title}:${f.fieldType}`
        )
      )

      // Prefer a free-text field; a ValueSelect only accepts its own options.
      const preferred =
        candidateFields.find((f: { fieldType: string }) =>
          ['String', 'LongText'].includes(f.fieldType)
        ) ?? candidateFields[0]

      if (preferred) {
        discovered.candidateFieldId = preferred.id
        discovered.candidateFieldType = preferred.fieldType
        discovered.candidateFieldOptions = (preferred.selectableValues ?? []).map(
          (v: { value: string }) => v.value
        )
        note('chosen field', `${preferred.title} (${preferred.fieldType}) ${preferred.id}`)
      } else {
        note('chosen field', 'NONE - no writable Candidate custom field exists')
      }
      expect(output.customFields.length).toBeGreaterThan(0)
    },
    TIMEOUT
  )
})

describe.skipIf(!WRITES)('ashby live (writes on fixtures)', () => {
  beforeAll(useRealFetch)

  const stamp = new Date().toISOString()
  const fixtureName = `ZZ SIM E2E TEST ${stamp}`
  const state: { candidateId?: string; applicationId?: string } = {}

  it(
    'creates the fixture candidate',
    async () => {
      const output = await call(createCandidateTool, {
        apiKey,
        name: fixtureName,
        email: `zz-sim-e2e-${Date.now()}@example.invalid`,
      })
      state.candidateId = output.id
      note('fixture candidate id', output.id)
      note('fixture candidate name', output.name)
      expect(output.id).toBeTruthy()
    },
    TIMEOUT
  )

  it(
    'writes a custom field value and reads it back',
    async () => {
      const fieldId = discovered.candidateFieldId
      if (!fieldId || !state.candidateId) {
        note('custom field write', 'SKIPPED - no field or candidate')
        return
      }
      const value =
        discovered.candidateFieldType === 'Number'
          ? 42
          : discovered.candidateFieldType === 'Boolean'
            ? true
            : discovered.candidateFieldType === 'MultiValueSelect'
              ? discovered.candidateFieldOptions?.slice(0, 1)
              : discovered.candidateFieldType === 'ValueSelect'
                ? discovered.candidateFieldOptions?.[0]
                : 'sim-e2e'

      const written = await call(setCustomFieldValueTool, {
        apiKey,
        objectId: state.candidateId,
        objectType: 'Candidate',
        fieldId,
        fieldValue: value,
      })
      note('written value', written.customField.value)

      const candidate = await call(getCandidateTool, { apiKey, candidateId: state.candidateId })
      const stored = candidate.customFields.find((f: { id: string }) => f.id === fieldId)
      note('value read back from candidate', stored?.value)
      expect(stored).toBeDefined()
    },
    TIMEOUT
  )

  it(
    'clears the custom field with null',
    async () => {
      const fieldId = discovered.candidateFieldId
      if (!fieldId || !state.candidateId) {
        note('custom field clear', 'SKIPPED')
        return
      }
      const cleared = await call(setCustomFieldValueTool, {
        apiKey,
        objectId: state.candidateId,
        objectType: 'Candidate',
        fieldId,
        fieldValue: null,
      })
      note('value after null write', cleared.customField.value)

      const candidate = await call(getCandidateTool, { apiKey, candidateId: state.candidateId })
      const stored = candidate.customFields.find((f: { id: string }) => f.id === fieldId)
      note('value read back after clear', stored ? stored.value : '(field absent)')
      expect(stored?.value ?? null).toBeNull()
    },
    TIMEOUT
  )

  it(
    'writes several fields at once and gets an array back',
    async () => {
      const fieldId = discovered.candidateFieldId
      if (!fieldId || !state.candidateId) {
        note('setValues', 'SKIPPED')
        return
      }
      const output = await call(setCustomFieldValuesTool, {
        apiKey,
        objectId: state.candidateId,
        objectType: 'Candidate',
        values: [{ fieldId, fieldValue: 'sim-e2e-plural' }],
      })
      note('setValues returned', output.customFields)
      expect(Array.isArray(output.customFields)).toBe(true)

      // Leave the fixture clean.
      await call(setCustomFieldValueTool, {
        apiKey,
        objectId: state.candidateId,
        objectType: 'Candidate',
        fieldId,
        fieldValue: null,
      })
    },
    TIMEOUT
  )

  it(
    'creates the fixture application on the approved job',
    async () => {
      const jobId = process.env.ASHBY_FIXTURE_JOB_ID
      if (!jobId || !state.candidateId || !discovered.hasCandidatesDelete) {
        note('fixture application', 'SKIPPED - no approved job or no candidatesDelete')
        return
      }
      const output = await call(createApplicationTool, {
        apiKey,
        candidateId: state.candidateId,
        jobId,
      })
      state.applicationId = output.id
      note('fixture application id', output.id)
      expect(output.id).toBeTruthy()
    },
    TIMEOUT
  )

  it(
    'changes the application source, then unsets it with an explicit null',
    async () => {
      if (!state.applicationId) {
        note('changeSource', 'SKIPPED - no fixture application')
        return
      }
      const sources = await call(listSourcesTool, { apiKey })
      const source = sources.sources?.find((s: { isArchived: boolean }) => !s.isArchived)
      note('source used', source ? `${source.title} ${source.id}` : 'none available')

      if (source) {
        const set = await call(changeApplicationSourceTool, {
          apiKey,
          applicationId: state.applicationId,
          sourceId: source.id,
        })
        note('source after set', set.source?.title ?? null)
        expect(set.source?.id).toBe(source.id)
      }

      // The spec detail most likely to be wrong: sourceId must be PRESENT and
      // null to unset. A dropped key is a 400, not a clear.
      const unset = await call(changeApplicationSourceTool, {
        apiKey,
        applicationId: state.applicationId,
        unsetSource: true,
      })
      note('source after explicit null', unset.source)
      expect(unset.source ?? null).toBeNull()
    },
    TIMEOUT
  )

  it(
    'deletes the fixture application',
    async () => {
      if (!state.applicationId) {
        note('delete', 'SKIPPED - no fixture application')
        return
      }
      const output = await call(deleteApplicationTool, {
        apiKey,
        applicationId: state.applicationId,
      })
      note('deleted application id', output.applicationId)
      expect(output.applicationId).toBe(state.applicationId)

      let stillThere = true
      try {
        await call(getApplicationTool, { apiKey, applicationId: state.applicationId })
      } catch (error) {
        stillThere = false
        note('get after delete', (error as Error).message)
      }
      expect(stillThere).toBe(false)
      state.applicationId = undefined
    },
    TIMEOUT
  )

  it(
    'anonymizes the fixture candidate last',
    async () => {
      if (!state.candidateId) {
        note('anonymize', 'SKIPPED')
        return
      }
      const output = await call(anonymizeCandidateTool, {
        apiKey,
        candidateId: state.candidateId,
      })
      note('name after anonymize', output.name)
      note('email after anonymize', output.primaryEmailAddress?.value ?? null)

      // Our documented limitation: the record survives, only the PII is gone.
      const after = await call(getCandidateTool, { apiKey, candidateId: state.candidateId })
      note('record still exists after anonymize', Boolean(after.id))
      expect(after.id).toBe(state.candidateId)
      expect(after.name).not.toBe(fixtureName)
    },
    TIMEOUT
  )

  it(
    'leaves the fixture in the expected final state',
    async () => {
      // Teardown is asserted, not assumed: no application survives, and the
      // custom field value we wrote is cleared rather than left behind.
      if (!state.candidateId) return
      const after = await call(getCandidateTool, { apiKey, candidateId: state.candidateId })
      const field = after.customFields.find(
        (f: { id: string }) => f.id === discovered.candidateFieldId
      )
      note('final custom field value', field ? field.value : '(field absent)')
      note('final application ids on fixture', after.applicationIds)
      expect(field?.value ?? null).toBeNull()
      expect(after.applicationIds).toEqual([])
    },
    TIMEOUT
  )
})
