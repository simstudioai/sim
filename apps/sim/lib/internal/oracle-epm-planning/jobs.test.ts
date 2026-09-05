/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
}))

import {
  classifyPlanningJob,
  planningJobResult,
  readPlanningJob,
  submitPlanningJob,
  validatePlanningJobParameters,
  waitForPlanningJob,
} from '@/lib/internal/oracle-epm-planning/jobs'
import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type { PlanningJob } from '@/tools/oracle_epm_planning/types'

const job: PlanningJob = {
  jobId: 42,
  status: 0,
  details: null,
  jobName: 'Calculate',
  descriptiveStatus: 'Completed',
}
const request = vi.fn()
const context: PlanningOperationContext = {
  client: { request, validateReturnedLink: vi.fn(), requestValidatedLink: vi.fn() },
}
describe('Planning job behavior using the foundation scheduler', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())
  it.each([-1, 2])('keeps status %i pending', (status) => {
    expect(classifyPlanningJob({ ...job, status }).state).toBe('pending')
  })
  it.each([1, 3, 4, 2147483647, 99])('does not treat status %i as success', (status) => {
    const snapshot = { ...job, status, details: 'Oracle job diagnostics' }
    expect(classifyPlanningJob(snapshot).state).toBe('failure')
    expect(planningJobResult(snapshot)).toMatchObject({ success: false, output: { job: snapshot } })
  })
  it('submits once and returns a pending snapshot without implicit polling', async () => {
    request.mockResolvedValue({ status: 200, data: { ...job, status: -1 } })
    await expect(
      submitPlanningJob({ application: 'Vision', jobType: 'RULES', jobName: 'Calculate' }, context)
    ).resolves.toMatchObject({ status: -1 })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      planningEndpoints.submitJob,
      expect.objectContaining({ json: { jobType: 'RULES', jobName: 'Calculate' } })
    )
  })
  it('waits for completion without resubmitting', async () => {
    vi.useFakeTimers()
    request
      .mockResolvedValueOnce({ status: 200, data: { ...job, status: -1 } })
      .mockResolvedValue({ status: 200, data: job })
    const pending = waitForPlanningJob(
      { application: 'Vision', jobId: '42', maxWaitSeconds: 5 },
      context
    )
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toEqual({ success: true, output: { job } })
    expect(request).toHaveBeenCalledTimes(2)
    for (const [endpoint] of request.mock.calls) expect(endpoint).toBe(planningEndpoints.job)
  })
  it('submits typed nested data-map overrides once without polling or replay', async () => {
    request.mockResolvedValue({ status: 200, data: { ...job, status: -1 } })
    const parameters = {
      clearData: false,
      overrideMembersMap: { Period: 'Q1' },
      overrideExclusionMembersMap: { Period: 'Jan' },
    }
    await expect(
      submitPlanningJob(
        { application: 'Vision', jobType: 'PLAN_TYPE_MAP', jobName: 'Reporting', parameters },
        context
      )
    ).resolves.toMatchObject({ status: -1 })
    expect(request).toHaveBeenCalledExactlyOnceWith(planningEndpoints.submitJob, {
      pathParams: { application: 'Vision' },
      json: { jobType: 'PLAN_TYPE_MAP', jobName: 'Reporting', parameters },
      signal: undefined,
    })
    request.mockClear()
    request.mockRejectedValue(new Error('Submission failed'))
    await expect(
      submitPlanningJob(
        { application: 'Vision', jobType: 'PLAN_TYPE_MAP', jobName: 'Reporting', parameters },
        context
      )
    ).rejects.toThrow('Submission failed')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('retains terminal failure diagnostics', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { ...job, status: 1, details: 'Invalid member' },
    })
    expect(await waitForPlanningJob({ application: 'Vision', jobId: '42' }, context)).toMatchObject(
      {
        success: false,
        output: { job: { status: 1, details: 'Invalid member' } },
      }
    )
  })
  it('rejects a status response for another job', async () => {
    request.mockResolvedValue({ status: 200, data: { ...job, jobId: 99 } })
    await expect(readPlanningJob({ application: 'Vision', jobId: '42' }, context)).rejects.toThrow(
      'different Planning job'
    )
  })
  it('propagates cancellation while a read is pending', async () => {
    const controller = new AbortController()
    request.mockImplementation(
      (_endpoint, input) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
        })
    )
    const pending = waitForPlanningJob(
      { application: 'Vision', jobId: '42' },
      { ...context, signal: controller.signal }
    )
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(new DOMException('Stopped', 'AbortError'))
    await assertion
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('propagates a timeout signal before reading', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Deadline exceeded', 'TimeoutError'))
    await expect(
      waitForPlanningJob(
        { application: 'Vision', jobId: '42', maxWaitSeconds: 1 },
        { ...context, signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(request).not.toHaveBeenCalled()
  })
  it('validates explicit data movement and conflicting overrides', () => {
    expect(
      validatePlanningJobParameters('export', {
        cube: 'Plan1',
        parameters: {
          rowMembers: 'Sales',
          columnMembers: 'Jan',
          povMembers: 'Plan',
          exportFileName: 'budget.zip',
        },
      })
    ).toMatchObject({ cube: 'Plan1', exportFileName: 'budget.zip' })
    expect(
      validatePlanningJobParameters('import', {
        fileName: 'data.csv',
        cube: 'Plan1',
        parameters: { sourceType: 'Essbase' },
      })
    ).toEqual({ importFileName: 'data.csv', cube: 'Plan1', sourceType: 'Essbase' })
    expect(() => validatePlanningJobParameters('export', {})).toThrow('requires cube')
    expect(() =>
      validatePlanningJobParameters('import', {
        parameters: { sourceType: 'Essbase', importFileName: 'data.csv' },
      })
    ).toThrow('requires a file')
    expect(() =>
      validatePlanningJobParameters('export', { cube: 'A', parameters: { cube: 'B' } })
    ).toThrow('conflicts')
    expect(() =>
      validatePlanningJobParameters('refresh', {
        jobName: 'Refresh',
        parameters: { guessedOption: true },
      })
    ).toThrow('Invalid job-specific')
    expect(validatePlanningJobParameters('refresh', { jobName: 'Refresh' })).toEqual({})
  })
})
