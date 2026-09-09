#!/usr/bin/env bun
/**
 * Read-only release gates. No dependencies/install or cloud writes are needed.
 * Usage: bun scripts/verify-release.ts worker|images|freshness|app
 * Inputs are the CI environment; outputs/diagnostics go to the Actions summary.
 * Recovery and required permissions are documented in simstudioai/infra's README.
 */
import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { interruptibleSleep } from '../packages/utils/src/helpers'

const exec = promisify(execFile)
const DIGEST = /^sha256:[a-f0-9]{64}$/
type ReadJson = <T>(command: string, args: string[], signal?: AbortSignal) => Promise<T>

const readJson: ReadJson = async <T>(
  command: string,
  args: string[],
  signal?: AbortSignal
): Promise<T> => {
  /** Never echo subprocess output: these gates only expose selected metadata. */
  const { stdout } = await exec(command, args, {
    timeout: 60_000,
    signal,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, AWS_PAGER: '', GH_PROMPT_DISABLED: '1' },
  }).catch(() => {
    signal?.throwIfAborted()
    throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed; check metadata permissions`)
  })
  return JSON.parse(stdout) as T
}

interface CheckRun {
  id: number
  name: string
  head_sha: string
  app: { slug: string }
  status: string
  conclusion: string | null
  details_url: string
}

/** Select the newest attempt, never an earlier green check for the same SHA. */
export function workerCheck(checks: CheckRun[], sha: string, project: string, environment: string) {
  const check = checks
    .filter(
      (item) =>
        item.head_sha === sha &&
        item.app.slug === 'trigger-dev-app' &&
        item.name === `Trigger.dev deployment (${project}:${environment})`
    )
    .sort((a, b) => b.id - a.id)[0]
  if (check?.status === 'completed' && check.conclusion !== 'success') {
    throw new Error(`Trigger check ${check.id} ended ${check.conclusion}`)
  }
  return check?.status === 'completed' && check.conclusion === 'success' ? check : undefined
}

export function promotionDecision(sha: string, head: string): 'promote' | 'skip' {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('A full commit SHA is required')
  }
  return sha === head ? 'promote' : 'skip'
}

/** Undefined means pending; API errors and terminal failures propagate immediately. */
export async function waitFor<T>(
  probe: (signal: AbortSignal) => Promise<T | undefined>,
  timeout: number
) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('Release verification timed out; release is incomplete'))
  }, timeout)
  try {
    while (true) {
      controller.signal.throwIfAborted()
      const result = await probe(controller.signal)
      controller.signal.throwIfAborted()
      if (result !== undefined) return result
      await interruptibleSleep(15_000, controller.signal)
    }
  } finally {
    clearTimeout(timer)
  }
}

interface Manifest {
  mediaType?: string
  config?: { digest: string }
  manifests?: { digest: string; platform?: { os: string; architecture: string } }[]
}

export function platformDigest(sourceDigest: string, manifest: Manifest): string {
  if (!DIGEST.test(sourceDigest)) throw new Error('Invalid registry digest')
  if (!manifest.manifests) {
    if (!manifest.config || !DIGEST.test(manifest.config.digest)) {
      throw new Error('Expected an image manifest or an amd64 image index')
    }
    return sourceDigest
  }
  const candidates = manifest.manifests.filter(
    (entry) => entry.platform?.os === 'linux' && entry.platform.architecture === 'amd64'
  )
  if (candidates.length !== 1 || !DIGEST.test(candidates[0].digest)) {
    throw new Error('Image index must contain exactly one linux/amd64 image')
  }
  return candidates[0].digest
}

interface Image {
  imageId: { imageDigest: string }
  imageManifest: string
  imageManifestMediaType: string
}

async function image(repository: string, tag: string, read: ReadJson) {
  const result = await read<{ images: Image[]; failures: { failureCode: string }[] }>('aws', [
    'ecr',
    'batch-get-image',
    '--repository-name',
    repository,
    '--image-ids',
    `imageTag=${tag}`,
    '--output',
    'json',
  ])
  if (result.failures.some((failure) => failure.failureCode !== 'ImageNotFound')) {
    throw new Error(`Cannot inspect image ${repository}:${tag}`)
  }
  if (result.images.length > 1) throw new Error(`Ambiguous image ${repository}:${tag}`)
  return result.images[0]
}

/** Compare deployable content, including legacy aliases wrapped in a single-image index. */
export function imagePromotion(source: Image, current?: Image) {
  const digest = platformDigest(source.imageId.imageDigest, JSON.parse(source.imageManifest))
  const unchanged =
    current &&
    platformDigest(current.imageId.imageDigest, JSON.parse(current.imageManifest)) === digest
  return {
    sourceDigest: source.imageId.imageDigest,
    platformDigest: digest,
    deployDigest: unchanged ? current.imageId.imageDigest : source.imageId.imageDigest,
    promote: !unchanged,
    manifest: source.imageManifest,
    mediaType: source.imageManifestMediaType,
  }
}

interface Execution {
  pipelineExecutionId: string
  status: string
  startTime: string
  sourceRevisions?: { actionName: string; revisionId: string }[]
}

/** Most recent matching attempt wins, including failed retries and infra-only releases. */
export function matchingExecution(executions: Execution[], digest: string) {
  const execution = executions
    .filter((item) =>
      item.sourceRevisions?.some(
        (source) => source.actionName === 'ECR_Source' && source.revisionId === digest
      )
    )
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0]
  if (
    execution &&
    executions.some(
      (item) =>
        Date.parse(item.startTime) > Date.parse(execution.startTime) &&
        item.sourceRevisions?.some(
          (source) => source.actionName === 'ECR_Source' && source.revisionId !== digest
        )
    )
  )
    throw new Error(`CodePipeline ${execution.pipelineExecutionId} was superseded by another image`)
  if (execution && !['InProgress', 'Succeeded'].includes(execution.status)) {
    throw new Error(`CodePipeline ${execution.pipelineExecutionId} ended ${execution.status}`)
  }
  return execution
}

interface ActionExecution {
  actionName: string
  startTime: string
  status: string
  output?: { executionResult?: { externalExecutionId?: string } }
}

interface TaskSet {
  status: string
  externalId: string
  taskDefinition: string
  stabilityStatus: string
  computedDesiredCount: number
  runningCount: number
  pendingCount: number
}

interface Task {
  taskDefinitionArn: string
  lastStatus: string
  containers: { name: string; imageDigest: string; lastStatus: string }[]
}

/** Correlate the source revision, deployment, PRIMARY task set and running image. */
export async function appReady(
  pipeline: string,
  cluster: string,
  service: string,
  sourceDigest: string,
  expectedPlatformDigest: string,
  read: ReadJson = readJson,
  report: (message: string) => void = () => {}
) {
  const { pipelineExecutionSummaries } = await read<{ pipelineExecutionSummaries: Execution[] }>(
    'aws',
    ['codepipeline', 'list-pipeline-executions', '--pipeline-name', pipeline, '--output', 'json']
  )
  const execution = matchingExecution(pipelineExecutionSummaries, sourceDigest)
  if (!execution) return undefined
  report(`CodePipeline execution \`${execution.pipelineExecutionId}\`: ${execution.status}.`)
  const { actionExecutionDetails } = await read<{ actionExecutionDetails: ActionExecution[] }>(
    'aws',
    [
      'codepipeline',
      'list-action-executions',
      '--pipeline-name',
      pipeline,
      '--max-items',
      '100',
      '--filter',
      `pipelineExecutionId=${execution.pipelineExecutionId}`,
      '--output',
      'json',
    ]
  )
  const action = actionExecutionDetails
    .filter((item) => item.actionName === 'Deploy_to_ECS')
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0]
  const deploymentId = action?.output?.executionResult?.externalExecutionId
  if (!deploymentId) return undefined
  report(`CodeDeploy deployment: \`${deploymentId}\`.`)
  const deployment = await read<{
    status: string
    rollbackInfo?: { rollbackDeploymentId?: string }
  }>('aws', [
    'deploy',
    'get-deployment',
    '--deployment-id',
    deploymentId,
    '--query',
    'deploymentInfo.{status:status,rollbackInfo:rollbackInfo}',
    '--output',
    'json',
  ])
  if (
    ['Failed', 'Stopped'].includes(deployment.status) ||
    deployment.rollbackInfo?.rollbackDeploymentId
  ) {
    throw new Error(`CodeDeploy ${deploymentId} failed or rolled back`)
  }
  if (
    execution.status !== 'Succeeded' ||
    action.status !== 'Succeeded' ||
    deployment.status !== 'Succeeded'
  ) {
    return undefined
  }
  const { taskSets, failures } = await read<{ taskSets: TaskSet[]; failures: unknown[] }>('aws', [
    'ecs',
    'describe-task-sets',
    '--cluster',
    cluster,
    '--service',
    service,
    '--output',
    'json',
  ])
  if (failures?.length) throw new Error('Could not describe app task sets')
  const primary = taskSets.filter((set) => set.status === 'PRIMARY')
  if (primary.length !== 1 || primary[0].externalId !== deploymentId) return undefined
  const set = primary[0]
  if (
    set.stabilityStatus !== 'STEADY_STATE' ||
    set.computedDesiredCount < 1 ||
    set.runningCount < set.computedDesiredCount ||
    set.pendingCount !== 0
  )
    return undefined
  const { taskArns } = await read<{ taskArns: string[] }>('aws', [
    'ecs',
    'list-tasks',
    '--cluster',
    cluster,
    '--service-name',
    service,
    '--desired-status',
    'RUNNING',
    '--output',
    'json',
  ])
  const tasks: Task[] = []
  for (let offset = 0; offset < taskArns.length; offset += 100) {
    const response = await read<{ tasks: Task[]; failures: unknown[] }>('aws', [
      'ecs',
      'describe-tasks',
      '--cluster',
      cluster,
      '--tasks',
      ...taskArns.slice(offset, offset + 100),
      '--query',
      '{failures:failures,tasks:tasks[].{taskDefinitionArn:taskDefinitionArn,lastStatus:lastStatus,containers:containers[].{name:name,imageDigest:imageDigest,lastStatus:lastStatus}}}',
      '--output',
      'json',
    ])
    if (response.failures?.length) return undefined
    tasks.push(...response.tasks)
  }
  const running = tasks.filter((task) => task.taskDefinitionArn === set.taskDefinition)
  if (
    running.length < set.computedDesiredCount ||
    !running.every(
      (task) =>
        task.lastStatus === 'RUNNING' &&
        task.containers.some(
          (container) =>
            container.name === 'app' &&
            container.lastStatus === 'RUNNING' &&
            container.imageDigest === expectedPlatformDigest
        )
    )
  )
    return undefined
  return { executionId: execution.pipelineExecutionId, deploymentId }
}

function required(name: string) {
  const value = process.env[name]
  if (!value || /[\r\n]/.test(value)) throw new Error(`Missing or invalid ${name}`)
  return value
}

function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function summary(message: string) {
  process.stdout.write(`${message}\n`)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`)
}

async function main() {
  const mode = process.argv[2]
  const sha = required('GITHUB_SHA')
  promotionDecision(sha, sha)
  const branch = required('GITHUB_REF_NAME')
  const environment = { main: 'production', staging: 'staging', dev: 'dev' }[branch]
  if (!environment) throw new Error(`Unsupported release branch: ${branch}`)
  summary(`Release \`${sha}\` / **${environment}** — ${mode}`)
  const repo = required('GITHUB_REPOSITORY')
  if (mode === 'freshness') {
    const { object } = await readJson<{ object: { sha: string } }>('gh', [
      'api',
      `repos/${repo}/git/ref/heads/${branch}`,
    ])
    const decision = promotionDecision(sha, object.sha)
    output('decision', decision)
    summary(
      decision === 'skip'
        ? 'Superseded: aliases will not move.'
        : 'Current branch head: promotion allowed.'
    )
  } else if (mode === 'worker') {
    if (environment === 'dev') {
      const version = required('TRIGGER_DEPLOYMENT_VERSION')
      summary(
        `Trigger preview/dev-sim version: \`${version}\` (successful CLI deployment in this run).`
      )
      return
    }
    const project = required('TRIGGER_PROJECT_ID')
    const check = await waitFor(async (signal) => {
      const pages = await readJson<{ check_runs: CheckRun[] }[]>(
        'gh',
        [
          'api',
          '--paginate',
          '--slurp',
          `repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100`,
        ],
        signal
      )
      return workerCheck(
        pages.flatMap((page) => page.check_runs),
        sha,
        project,
        environment === 'production' ? 'prod' : 'staging'
      )
    }, 45 * 60_000)
    summary(`Trigger check **${check.id}** succeeded: ${check.details_url}`)
  } else if (mode === 'images') {
    const repositories = required('ECR_REPOS').trim().split(/\s+/)
    if (repositories.length !== 4 || new Set(repositories).size !== 4) {
      throw new Error('All four distinct ECR repositories are required before promotion')
    }
    const tag = environment === 'production' ? 'latest' : environment
    const images = await Promise.all(
      repositories.map(async (repository) => {
        const [source, current] = await Promise.all([
          image(repository, sha, readJson),
          image(repository, tag, readJson),
        ])
        if (!source) throw new Error(`Missing SHA image: ${repository}:${sha}`)
        return { repository, ...imagePromotion(source, current) }
      })
    )
    output('images', JSON.stringify(images))
    const app = images.find((entry) => entry.repository === required('ECR_APP'))
    if (!app) throw new Error('App repository is missing from image preflight')
    output('app_digest', app.deployDigest)
    output('app_platform_digest', app.platformDigest)
    for (const item of images)
      summary(
        `\`${item.repository}\`: ${item.promote ? 'promote' : 'reuse'} \`${item.deployDigest}\` (amd64 \`${item.platformDigest}\`).`
      )
  } else if (mode === 'app') {
    const source = required('APP_DIGEST')
    const platform = required('APP_PLATFORM_DIGEST')
    if (!DIGEST.test(source) || !DIGEST.test(platform))
      throw new Error('Invalid expected app digests')
    const prefix = `sim-${environment}-${required('AWS_REGION')}`
    const reported = new Set<string>()
    const report = (message: string) => {
      if (!reported.has(message)) summary(message)
      reported.add(message)
    }
    const result = await waitFor(
      (signal) =>
        appReady(
          `${prefix}-app-deployment`,
          `${prefix}-cluster`,
          `${prefix}-app`,
          source,
          platform,
          (command, args) => readJson(command, args, signal),
          report
        ),
      75 * 60_000
    )
    summary(
      `App deployment verified: pipeline execution \`${result.executionId}\`, CodeDeploy \`${result.deploymentId}\`.`
    )
    output('complete', 'true')
  } else {
    throw new Error('Usage: verify-release.ts worker|images|freshness|app')
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    summary(`**Incomplete release:** ${String(error)}`)
    process.exitCode = 1
  })
}
