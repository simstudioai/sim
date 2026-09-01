/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isSensitiveKey } from '@/lib/core/security/redaction'
import { anonymizeCandidateTool } from '@/tools/ashby/anonymize_candidate'
import { changeApplicationSourceTool } from '@/tools/ashby/change_application_source'
import { changeApplicationStageTool } from '@/tools/ashby/change_application_stage'
import { deleteApplicationTool } from '@/tools/ashby/delete_application'
import { getApplicationTool } from '@/tools/ashby/get_application'
import { getCandidateTool } from '@/tools/ashby/get_candidate'
import { getJobPostingTool } from '@/tools/ashby/get_job_posting'
import { listApplicationsTool } from '@/tools/ashby/list_applications'
import { listCandidatesTool } from '@/tools/ashby/list_candidates'
import { listInterviewPlansTool } from '@/tools/ashby/list_interview_plans'
import { listInterviewStagesTool } from '@/tools/ashby/list_interview_stages'
import { listJobPostingsTool } from '@/tools/ashby/list_job_postings'
import { listJobsTool } from '@/tools/ashby/list_jobs'
import { listNotesTool } from '@/tools/ashby/list_notes'
import { listOffersTool } from '@/tools/ashby/list_offers'
import { searchJobsTool } from '@/tools/ashby/search_jobs'
import { setCustomFieldValueTool } from '@/tools/ashby/set_custom_field_value'
import { setCustomFieldValuesTool } from '@/tools/ashby/set_custom_field_values'
import { transferApplicationTool } from '@/tools/ashby/transfer_application'
import { updateCandidateTool } from '@/tools/ashby/update_candidate'
import { ashbyAuthHeaders } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function requestBody(tool: ToolConfig<never, never>, params: unknown): Record<string, unknown> {
  const build = tool.request?.body as (p: unknown) => Record<string, unknown>
  return build(params)
}

async function transform(tool: ToolConfig<never, never>, body: unknown) {
  const run = tool.transformResponse as (r: Response) => Promise<{ output: Record<string, never> }>
  return run(respond(body))
}

describe('ashby request bodies', () => {
  it('adds X-On-Behalf-Of only when an acting user is supplied', () => {
    expect(ashbyAuthHeaders('k', ' user-1 ')['X-On-Behalf-Of']).toBe('user-1')
    expect(ashbyAuthHeaders('k')).not.toHaveProperty('X-On-Behalf-Of')
  })

  it('validates dates and page sizes instead of silently dropping invalid values', () => {
    expect(() => requestBody(listCandidatesTool, { apiKey: 'k', createdAfter: 'nope' })).toThrow(
      /ISO 8601/
    )
    expect(() => requestBody(listCandidatesTool, { apiKey: 'k', perPage: 1.5 })).toThrow(
      /integer from 1 to 100/
    )
  })

  it('retrieves unpublished job postings only when explicitly requested', () => {
    expect(
      requestBody(getJobPostingTool, {
        apiKey: 'k',
        jobPostingId: 'p',
        includeUnpublishedJobPostings: true,
      })
    ).toMatchObject({ jobPostingId: 'p', includeUnpublishedJobPostings: true })
  })

  it('requires a supported job search criterion', () => {
    expect(() => requestBody(searchJobsTool, { apiKey: 'k' })).toThrow(/title or requisition ID/)
    expect(requestBody(searchJobsTool, { apiKey: 'k', title: 'Engineer', limit: 25 })).toEqual({
      title: 'Engineer',
      limit: 25,
    })
  })

  it('sends every required application transfer coordinate and attribution header', () => {
    expect(
      requestBody(transferApplicationTool, {
        apiKey: 'k',
        applicationId: ' a ',
        jobId: ' j ',
        interviewPlanId: ' p ',
        interviewStageId: ' s ',
        startAutomaticActivities: true,
      })
    ).toEqual({
      applicationId: 'a',
      jobId: 'j',
      interviewPlanId: 'p',
      interviewStageId: 's',
      startAutomaticActivities: true,
    })
    expect(
      transferApplicationTool.request?.headers?.({ apiKey: 'k', onBehalfOfUserId: 'u' } as never)
    ).toHaveProperty('X-On-Behalf-Of', 'u')
  })

  it('supports alternate identifiers for candidate and application lookups', () => {
    expect(
      requestBody(getCandidateTool, { apiKey: 'k', externalMappingId: ' external-1 ' })
    ).toEqual({ externalMappingId: 'external-1' })
    expect(
      requestBody(getApplicationTool, {
        apiKey: 'k',
        submittedFormInstanceId: ' form-1 ',
        expand: ['candidate'],
      })
    ).toEqual({ submittedFormInstanceId: 'form-1', expand: ['candidate'] })
    expect(() =>
      requestBody(getCandidateTool, {
        apiKey: 'k',
        candidateId: 'candidate-1',
        externalMappingId: 'external-1',
      })
    ).toThrow(/exactly one/)
  })

  it('sends the application status as a scalar and exposes draft posting IDs for job lists', () => {
    expect(requestBody(listApplicationsTool, { apiKey: 'k', status: ' Active ' }).status).toBe(
      'Active'
    )
    expect(
      requestBody(listJobsTool, {
        apiKey: 'k',
        status: ['Open', 'Draft'],
        includeUnpublishedJobPostingsIds: true,
      })
    ).toMatchObject({
      status: ['Open', 'Draft'],
      includeUnpublishedJobPostingsIds: true,
    })
    expect(requestBody(listJobsTool, { apiKey: 'k', status: '["Open","Draft"]' }).status).toEqual([
      'Open',
      'Draft',
    ])
  })

  it('omits null and blank optional limits without weakening explicit validation', () => {
    expect(requestBody(listCandidatesTool, { apiKey: 'k', perPage: null })).not.toHaveProperty(
      'limit'
    )
    expect(requestBody(listInterviewPlansTool, { apiKey: 'k', perPage: '' })).not.toHaveProperty(
      'limit'
    )
    expect(requestBody(searchJobsTool, { apiKey: 'k', title: 'Engineer', limit: null })).toEqual({
      title: 'Engineer',
    })
    expect(() => requestBody(searchJobsTool, { apiKey: 'k', title: 'Engineer', limit: 0 })).toThrow(
      /integer from 1 to 100/
    )
  })

  it('validates note page size and supports explicit candidate field clearing', () => {
    expect(() => requestBody(listNotesTool, { candidateId: 'c', perPage: 101 })).toThrow(
      /integer from 1 to 100/
    )
    expect(
      requestBody(updateCandidateTool, {
        candidateId: 'c',
        clearSource: true,
        clearCreditedToUser: true,
        location: { city: 'Seattle', region: 'WA', country: 'US' },
      })
    ).toEqual({
      candidateId: 'c',
      sourceId: null,
      creditedToUserId: null,
      location: { city: 'Seattle', region: 'WA', country: 'US' },
    })
  })

  it('supports clearing all social links and rejects Ashby-ignored field combinations', () => {
    expect(
      requestBody(updateCandidateTool, { candidateId: 'c', socialLinks: [] }).socialLinks
    ).toEqual([])
    expect(
      requestBody(updateCandidateTool, { candidateId: 'c', socialLinks: null }).socialLinks
    ).toBeNull()
    expect(() =>
      requestBody(updateCandidateTool, {
        candidateId: 'c',
        socialLinks: [],
        linkedInUrl: 'https://linkedin.com/in/example',
      })
    ).toThrow(/mutually exclusive/)
  })

  it('preserves documented nullable candidate update fields', () => {
    expect(
      requestBody(updateCandidateTool, {
        candidateId: 'c',
        name: null,
        email: null,
        phoneNumber: null,
        linkedInUrl: null,
        githubUrl: null,
        websiteUrl: null,
        alternateEmail: null,
        location: null,
        createdAt: null,
        sendNotifications: null,
      })
    ).toEqual({
      candidateId: 'c',
      name: null,
      email: null,
      phoneNumber: null,
      linkedInUrl: null,
      githubUrl: null,
      websiteUrl: null,
      alternateEmail: null,
      location: null,
      createdAt: null,
      sendNotifications: null,
    })
  })

  it('sends Ashby archive email configuration as the documented object', () => {
    expect(
      requestBody(changeApplicationStageTool, {
        applicationId: 'app-1',
        interviewStageId: 'stage-1',
        archiveEmail: {
          communicationTemplateId: ' template-1 ',
          sendAt: '2026-09-02T16:32:00Z',
        },
      }).archiveEmail
    ).toEqual({
      communicationTemplateId: 'template-1',
      sendAt: '2026-09-02T16:32:00Z',
    })
    expect(() =>
      requestBody(changeApplicationStageTool, {
        applicationId: 'app-1',
        interviewStageId: 'stage-1',
        archiveEmail: { communicationTemplateId: 'template-1', sendAt: 'tomorrow-ish' },
      })
    ).toThrow(/ISO 8601/)
  })

  it('forwards all documented offer list filters', () => {
    expect(
      requestBody(listOffersTool, {
        apiKey: 'k',
        offerStatus: ['Created'],
        acceptanceStatus: ['Accepted'],
        approvalStatus: ['Approved'],
      })
    ).toMatchObject({
      offerStatus: ['Created'],
      acceptanceStatus: ['Accepted'],
      approvalStatus: ['Approved'],
    })
  })
  it('list_jobs forwards a sync token and omits the key when absent', () => {
    expect(requestBody(listJobsTool, { apiKey: 'k', syncToken: 'tok' }).syncToken).toBe('tok')
    expect(requestBody(listJobsTool, { apiKey: 'k' })).not.toHaveProperty('syncToken')
  })

  it('list_job_postings uses the jobPosting.list spelling, not the job.list one', () => {
    // job.list takes `includeUnpublishedJobPostingsIds`, a different parameter
    // with a different meaning. Sending that name here is silently ignored.
    const body = requestBody(listJobPostingsTool, {
      apiKey: 'k',
      includeUnpublishedJobPostings: true,
    })
    expect(body.includeUnpublishedJobPostings).toBe(true)
    expect(body).not.toHaveProperty('includeUnpublishedJobPostingsIds')
  })

  it('change_application_source sends sourceId when one is provided', () => {
    // Ashby requires the key to be present; omitting it is a 400 rather than
    // the intended write.
    expect(
      requestBody(changeApplicationSourceTool, { applicationId: ' a ', sourceId: ' s ' })
    ).toEqual({
      applicationId: 'a',
      sourceId: 's',
    })
  })

  it('does not mark fieldValue required, so a null clear survives validation', () => {
    // validateRequiredParametersAfterMerge rejects a required `user-or-llm`
    // param whose value is null, which would make clearing a custom field
    // impossible - the exact operation the null value exists for.
    expect(setCustomFieldValueTool.params.fieldValue.required).toBe(false)
    expect(setCustomFieldValueTool.params.objectId.required).toBe(true)
    expect(setCustomFieldValueTool.params.fieldId.required).toBe(true)
  })

  it('set_custom_field_value preserves an explicit null so a field can be cleared', () => {
    expect(
      requestBody(setCustomFieldValueTool, {
        objectId: 'o',
        objectType: 'Job',
        fieldId: 'f',
        fieldValue: null,
      })
    ).toEqual({ objectId: 'o', objectType: 'Job', fieldId: 'f', fieldValue: null })
  })

  it('refuses to clear the field when the value was merely omitted', () => {
    // null clears the field, so an absent value must not become one: a dropped
    // variable, an unresolved reference, or a model call that forgot the
    // argument would otherwise silently destroy the stored value.
    expect(() =>
      requestBody(setCustomFieldValueTool, { objectId: 'o', objectType: 'Job', fieldId: 'f' })
    ).toThrow(/required. Pass null to clear/)
    expect(() =>
      requestBody(setCustomFieldValueTool, {
        objectId: 'o',
        objectType: 'Job',
        fieldId: 'f',
        fieldValue: '   ',
      })
    ).toThrow(/required. Pass null to clear/)
  })

  it('set_custom_field_values sends the values array', () => {
    const values = [{ fieldId: 'f', fieldValue: 'High' }]
    expect(
      requestBody(setCustomFieldValuesTool, { objectId: 'o', objectType: 'Job', values }).values
    ).toEqual(values)
  })

  it('rejects an empty values array before it reaches Ashby', () => {
    expect(() =>
      requestBody(setCustomFieldValuesTool, { objectId: 'o', objectType: 'Job', values: [] })
    ).toThrow(/non-empty array/)
  })

  it('refuses to unset an application source unless asked explicitly', () => {
    // The endpoint has no "leave unchanged" mode, so a dropped variable or a
    // model call that omits sourceId would otherwise wipe attribution and still
    // report success.
    expect(() => requestBody(changeApplicationSourceTool, { applicationId: 'a' })).toThrow(
      /unsetSource/
    )
    expect(
      requestBody(changeApplicationSourceTool, { applicationId: 'a', unsetSource: true }).sourceId
    ).toBeNull()
  })

  it('rejects a source id and an unset request together', () => {
    // Preferring either one silently discards the other, which is how an
    // intentional clear turns into a set nobody asked for.
    expect(() =>
      requestBody(changeApplicationSourceTool, {
        applicationId: 'a',
        sourceId: 's',
        unsetSource: true,
      })
    ).toThrow(/mutually exclusive/)
  })

  it('rejects an object type Ashby would not accept', () => {
    // objectType is user-or-llm and Ashby's enum is case-sensitive.
    expect(() =>
      requestBody(setCustomFieldValueTool, {
        objectId: 'o',
        objectType: 'Sandwich',
        fieldId: 'f',
        fieldValue: 'x',
      })
    ).toThrow(/Expected one of/)
    expect(
      requestBody(setCustomFieldValueTool, {
        objectId: ' o ',
        objectType: 'candidate',
        fieldId: ' f ',
        fieldValue: 'x',
      })
    ).toEqual({ objectId: 'o', objectType: 'Candidate', fieldId: 'f', fieldValue: 'x' })
  })

  it('trims ids on the single-id operations', () => {
    expect(requestBody(deleteApplicationTool, { applicationId: ' app-1 ' }).applicationId).toBe(
      'app-1'
    )
    expect(requestBody(anonymizeCandidateTool, { candidateId: ' cand-1 ' }).candidateId).toBe(
      'cand-1'
    )
  })
})

describe('ashby response transforms', () => {
  it('does not invent pagination metadata for interviewStage.list', async () => {
    const result = await transform(listInterviewStagesTool, {
      success: true,
      results: [{ id: 'stage-1', title: 'Screen' }],
      moreDataAvailable: true,
    })
    expect(result.output.interviewStages).toEqual([{ id: 'stage-1', title: 'Screen' }])
    expect(result.output).not.toHaveProperty('moreDataAvailable')
  })

  it('surfaces sync cursors consistently across candidate and interview-plan lists', async () => {
    const candidates = await transform(listCandidatesTool, {
      success: true,
      results: [],
      syncToken: 'candidate-sync',
    })
    const plans = await transform(listInterviewPlansTool, {
      success: true,
      results: [],
      syncToken: 'plan-sync',
    })
    expect(candidates.output.nextSyncCursor).toBe('candidate-sync')
    expect(plans.output.nextSyncCursor).toBe('plan-sync')
  })
  it('exposes the sync cursor under a name redaction does not treat as a secret', async () => {
    // `syncToken` matches the /^.*token$/i deny-list, so surfacing it under that
    // name renders it [REDACTED] in block output - and an incremental sync is
    // useless if the operator cannot read the cursor for the next run. It is an
    // opaque resumption marker, so it belongs with nextCursor, not with API keys.
    expect(isSensitiveKey('syncToken')).toBe(true)
    expect(isSensitiveKey('nextSyncCursor')).toBe(false)
    expect(isSensitiveKey('nextCursor')).toBe(false)
  })

  it('list_jobs surfaces the sync cursor and the confidential flag', async () => {
    const result = await transform(listJobsTool, {
      success: true,
      results: [{ id: 'j1', title: 'Engineer', confidential: true }],
      moreDataAvailable: false,
      syncToken: 'next-token',
    })
    expect(result.output.nextSyncCursor).toBe('next-token')
    expect(result.output.jobs[0].confidential).toBe(true)
  })

  it('list_jobs reports a null sync token on a non-final page', async () => {
    // Ashby only returns a sync token once the last page is drained, so callers
    // must not persist what comes back mid-pagination.
    const result = await transform(listJobsTool, {
      success: true,
      results: [],
      moreDataAvailable: true,
      nextCursor: 'cursor-1',
    })
    expect(result.output.nextSyncCursor).toBeNull()
  })

  it('set_custom_field_value maps the single result object', async () => {
    const result = await transform(setCustomFieldValueTool, {
      success: true,
      results: { id: 'cf', title: 'Priority', isPrivate: false, value: 'High', valueLabel: 'High' },
    })
    expect(result.output.customField).toEqual({
      id: 'cf',
      title: 'Priority',
      isPrivate: false,
      value: 'High',
      valueLabel: 'High',
    })
  })

  it('set_custom_field_values maps the result array', async () => {
    // The plural endpoint returns an array where the singular returns an object.
    const result = await transform(setCustomFieldValuesTool, {
      success: true,
      results: [
        { id: 'a', title: 'A', value: 1 },
        { id: 'b', title: 'B', value: null },
      ],
    })
    expect(result.output.customFields).toHaveLength(2)
    expect(result.output.customFields[1].value).toBeNull()
  })

  it('delete_application surfaces the deleted id', async () => {
    const result = await transform(deleteApplicationTool, {
      success: true,
      results: { applicationId: 'app-1' },
    })
    expect(result.output.applicationId).toBe('app-1')
  })

  it('delete_application reports a missing permission readably', async () => {
    // candidatesDelete is a separate module permission, so this is the most
    // likely failure for this operation and must not surface as [object Object].
    await expect(
      transform(deleteApplicationTool, {
        success: false,
        errors: [{ message: 'missing_endpoint_permission' }],
      })
    ).rejects.toThrow('missing_endpoint_permission')
  })

  it('every new tool surfaces an Ashby failure readably', async () => {
    // The object-shaped errors array is the form Ashby's own spec documents, and
    // it is what these messages are built from - each tool must unwrap it rather
    // than stringify the entry.
    const failure = { success: false, errors: [{ message: 'invalid_input', parameter: 'x' }] }
    for (const tool of [
      setCustomFieldValueTool,
      setCustomFieldValuesTool,
      anonymizeCandidateTool,
      changeApplicationSourceTool,
    ]) {
      await expect(transform(tool, failure)).rejects.toThrow('invalid_input (x)')
    }
  })

  it('anonymize_candidate maps the returned candidate', async () => {
    const result = await transform(anonymizeCandidateTool, {
      success: true,
      results: { id: 'cand-1', name: 'Anonymous cand-1', primaryEmailAddress: null },
    })
    expect(result.output.id).toBe('cand-1')
    expect(result.output.name).toBe('Anonymous cand-1')
  })

  it('change_application_source maps the returned application', async () => {
    const result = await transform(changeApplicationSourceTool, {
      success: true,
      results: { id: 'app-1', status: 'Active', source: null },
    })
    expect(result.output.id).toBe('app-1')
    expect(result.output.source).toBeNull()
  })

  it('keeps an array valueLabel intact for MultiValueSelect fields', async () => {
    // This is why AshbyCustomField.valueLabel widened to string | string[];
    // a mapper that coerced it would silently drop the labels.
    const result = await transform(setCustomFieldValueTool, {
      success: true,
      results: { id: 'cf', title: 'Modes', value: ['a', 'b'], valueLabel: ['A', 'B'] },
    })
    expect(result.output.customField.valueLabel).toEqual(['A', 'B'])
    expect(result.output.customField.value).toEqual(['a', 'b'])
  })

  it('list_job_postings surfaces draft status on the new field', async () => {
    const result = await transform(listJobPostingsTool, {
      success: true,
      results: [
        { id: 'p1', title: 'A', status: 'Published' },
        { id: 'p2', title: 'B', status: 'Draft' },
      ],
    })
    expect(result.output.jobPostings.map((p: { status: string }) => p.status)).toEqual([
      'Published',
      'Draft',
    ])
  })

  it('defaults missing result payloads instead of throwing', async () => {
    const deleted = await transform(deleteApplicationTool, { success: true, results: {} })
    expect(deleted.output.applicationId).toBe('')
    const plural = await transform(setCustomFieldValuesTool, { success: true })
    expect(plural.output.customFields).toEqual([])
  })
})
