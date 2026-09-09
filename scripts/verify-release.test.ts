import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appReady,
  imagePromotion,
  matchingExecution,
  platformDigest,
  promotionDecision,
  waitFor,
  workerCheck,
} from './verify-release'

const SHA = 'a'.repeat(40)
const DIGEST = `sha256:${'b'.repeat(64)}`
const INDEX = `sha256:${'c'.repeat(64)}`
const OTHER = `sha256:${'d'.repeat(64)}`
const check = {
  id: 1,
  name: 'Trigger.dev deployment (proj_sim:staging)',
  head_sha: SHA,
  app: { slug: 'trigger-dev-app' },
  status: 'completed',
  conclusion: 'success',
  details_url: 'https://cloud.trigger.dev/deployment',
}
const execution = {
  pipelineExecutionId: 'execution-1',
  status: 'Succeeded',
  startTime: '2026-09-09T12:00:00Z',
  sourceRevisions: [{ actionName: 'ECR_Source', revisionId: INDEX }],
}

afterEach(() => vi.useRealTimers())

describe('release prerequisites', () => {
  it('accepts only the exact worker identity from the trusted GitHub app', () => {
    expect(workerCheck([check], SHA, 'proj_sim', 'staging')).toEqual(check)
    for (const unrelated of [
      { ...check, head_sha: 'e'.repeat(40) },
      { ...check, app: { slug: 'another-app' } },
      { ...check, name: 'Trigger.dev deployment (proj_other:staging)' },
      { ...check, name: 'Trigger.dev deployment (proj_sim:prod)' },
    ]) {
      expect(workerCheck([unrelated], SHA, 'proj_sim', 'staging')).toBeUndefined()
    }
  })

  it('does not let an older success hide a pending or failed worker retry', () => {
    expect(
      workerCheck([check, { ...check, id: 2, status: 'in_progress' }], SHA, 'proj_sim', 'staging')
    ).toBeUndefined()
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      expect(() =>
        workerCheck([check, { ...check, id: 2, conclusion }], SHA, 'proj_sim', 'staging')
      ).toThrow(conclusion)
    }
  })

  it('bounds absent worker checks and propagates API errors without promotion', async () => {
    vi.useFakeTimers()
    const pending = waitFor(async () => workerCheck([], SHA, 'proj_sim', 'staging'), 45 * 60_000)
    const rejected = expect(pending).rejects.toThrow('incomplete')
    await vi.advanceTimersByTimeAsync(45 * 60_000)
    await rejected
    await expect(
      waitFor(async () => {
        throw new Error('permission denied')
      }, 1000)
    ).rejects.toThrow('permission denied')
  })

  it('allows only the exact branch head, including reruns', () => {
    expect(promotionDecision(SHA, SHA)).toBe('promote')
    expect(promotionDecision(SHA, 'e'.repeat(40))).toBe('skip')
    expect(() => promotionDecision(SHA, '')).toThrow('full commit SHA')
  })
})

describe('image identity', () => {
  const manifest = { config: { digest: OTHER } }
  const index = {
    manifests: [{ digest: DIGEST, platform: { os: 'linux', architecture: 'amd64' } }],
  }
  const source = {
    imageId: { imageDigest: DIGEST },
    imageManifest: JSON.stringify(manifest),
    imageManifestMediaType: 'application/vnd.oci.image.manifest.v1+json',
  }

  it('reuses identical content without confusing index and running-image digests', () => {
    expect(imagePromotion(source, source)).toMatchObject({ promote: false, deployDigest: DIGEST })
    expect(
      imagePromotion(source, {
        ...source,
        imageId: { imageDigest: INDEX },
        imageManifest: JSON.stringify(index),
      })
    ).toMatchObject({ promote: false, deployDigest: INDEX, platformDigest: DIGEST })
    expect(imagePromotion(source)).toMatchObject({ promote: true, deployDigest: DIGEST })
    expect(imagePromotion(source, { ...source, imageId: { imageDigest: OTHER } }).promote).toBe(
      true
    )
  })

  it('rejects ambiguous or missing amd64 manifests', () => {
    expect(platformDigest(INDEX, index)).toBe(DIGEST)
    expect(() => platformDigest(INDEX, { manifests: [] })).toThrow('exactly one')
    expect(() =>
      platformDigest(INDEX, { manifests: [...index.manifests, ...index.manifests] })
    ).toThrow('exactly one')
  })
})

/** Small provider-response fixtures exercise the correlation, without live AWS or secrets. */
function awsFixture(
  options: {
    pipelineStatus?: string
    deploymentStatus?: string
    rollback?: boolean
    primaryDeployment?: string
    digest?: string
    sourceDigest?: string
  } = {}
) {
  const responses: Record<string, unknown> = {
    'codepipeline list-pipeline-executions': {
      pipelineExecutionSummaries: [
        {
          ...execution,
          status: options.pipelineStatus ?? 'Succeeded',
          sourceRevisions: [
            { actionName: 'ECR_Source', revisionId: options.sourceDigest ?? INDEX },
          ],
        },
      ],
    },
    'codepipeline list-action-executions': {
      actionExecutionDetails: [
        {
          actionName: 'Deploy_to_ECS',
          startTime: execution.startTime,
          status: 'Succeeded',
          output: { executionResult: { externalExecutionId: 'd-release' } },
        },
      ],
    },
    'deploy get-deployment': {
      status: options.deploymentStatus ?? 'Succeeded',
      rollbackInfo: options.rollback ? { rollbackDeploymentId: 'd-rollback' } : {},
    },
    'ecs describe-task-sets': {
      failures: [],
      taskSets: [
        {
          status: 'PRIMARY',
          externalId: options.primaryDeployment ?? 'd-release',
          taskDefinition: 'taskdef:2',
          stabilityStatus: 'STEADY_STATE',
          computedDesiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
        },
      ],
    },
    'ecs list-tasks': { taskArns: ['task'] },
    'ecs describe-tasks': {
      failures: [],
      tasks: [
        {
          taskDefinitionArn: 'taskdef:2',
          lastStatus: 'RUNNING',
          containers: [
            { name: 'app', lastStatus: 'RUNNING', imageDigest: options.digest ?? DIGEST },
          ],
        },
      ],
    },
  }
  return async <T>(_command: string, args: string[]): Promise<T> => {
    const key = args.slice(0, 2).join(' ')
    if (!(key in responses)) throw new Error(`Unexpected metadata read: ${key}`)
    return responses[key] as T
  }
}

describe('app completion', () => {
  const verify = (read: ReturnType<typeof awsFixture>) =>
    appReady('pipeline', 'cluster', 'service', INDEX, DIGEST, read)

  it('verifies an existing successful deployment again without starting another one', async () => {
    const read = awsFixture()
    const expected = { executionId: 'execution-1', deploymentId: 'd-release' }
    expect(await verify(read)).toEqual(expected)
    expect(await verify(read)).toEqual(expected)
  })

  it('does not report success for pending, failed, rolled-back or mismatched deployments', async () => {
    for (const options of [
      { pipelineStatus: 'InProgress' },
      { sourceDigest: OTHER },
      { digest: OTHER },
      { primaryDeployment: 'd-old' },
    ])
      expect(await verify(awsFixture(options))).toBeUndefined()
    for (const options of [
      { pipelineStatus: 'Failed' },
      { pipelineStatus: 'Superseded' },
      { deploymentStatus: 'Failed' },
      { rollback: true },
    ])
      await expect(verify(awsFixture(options))).rejects.toThrow()
  })

  it('selects the latest matching attempt and accepts it after operator recovery', async () => {
    const retry = {
      ...execution,
      pipelineExecutionId: 'execution-2',
      startTime: '2026-09-09T13:00:00Z',
    }
    expect(() => matchingExecution([execution, { ...retry, status: 'Failed' }], INDEX)).toThrow(
      'execution-2'
    )
    expect(matchingExecution([retry, execution], INDEX)).toEqual(retry)
    expect(() =>
      matchingExecution(
        [
          execution,
          {
            ...retry,
            sourceRevisions: [{ actionName: 'ECR_Source', revisionId: OTHER }],
          },
        ],
        INDEX
      )
    ).toThrow('superseded by another image')
    vi.useFakeTimers()
    let read = awsFixture({ pipelineStatus: 'InProgress' })
    const recovering = waitFor(() => verify(read), 75 * 60_000)
    await vi.advanceTimersByTimeAsync(15_000)
    read = awsFixture()
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(recovering).resolves.toMatchObject({ deploymentId: 'd-release' })
  })
})
