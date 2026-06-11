import type {
  TriggerDevApiAttempt,
  TriggerDevApiQueue,
  TriggerDevApiRun,
  TriggerDevApiRunDetail,
  TriggerDevApiSchedule,
  TriggerDevAttempt,
  TriggerDevQueue,
  TriggerDevRunDetail,
  TriggerDevRunSummary,
  TriggerDevSchedule,
} from '@/tools/trigger_dev/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

export const TRIGGER_DEV_API_BASE = 'https://api.trigger.dev'

/**
 * Builds the standard headers for Trigger.dev management API requests.
 */
export function buildTriggerDevHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Splits a comma-separated string into trimmed, non-empty values.
 */
export function splitCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Normalizes a JSON parameter that may arrive as a parsed value or a JSON string.
 * Throws a descriptive error when the string is not valid JSON.
 */
export function parseJsonInput(value: unknown, paramName: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Invalid JSON in ${paramName} parameter`)
  }
}

/**
 * Builds the URL for the environment variable endpoints of a project environment.
 */
export function buildTriggerDevEnvVarsUrl(
  projectRef: string,
  environment: string,
  name?: string
): string {
  const base = `${TRIGGER_DEV_API_BASE}/api/v1/projects/${encodeURIComponent(projectRef.trim())}/envvars/${encodeURIComponent(environment.trim())}`
  return name ? `${base}/${encodeURIComponent(name.trim())}` : base
}

/**
 * Maps a raw Trigger.dev run object to the normalized run summary shape.
 */
export function mapTriggerDevRunSummary(run: TriggerDevApiRun): TriggerDevRunSummary {
  return {
    id: run.id,
    status: run.status,
    taskIdentifier: run.taskIdentifier,
    version: run.version ?? null,
    idempotencyKey: run.idempotencyKey ?? null,
    isTest: run.isTest ?? false,
    createdAt: run.createdAt ?? null,
    updatedAt: run.updatedAt ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    delayedUntil: run.delayedUntil ?? null,
    ttl: run.ttl ?? null,
    expiredAt: run.expiredAt ?? null,
    tags: run.tags ?? [],
    costInCents: run.costInCents ?? null,
    baseCostInCents: run.baseCostInCents ?? null,
    durationMs: run.durationMs ?? null,
    env: run.env
      ? {
          id: run.env.id ?? null,
          name: run.env.name ?? null,
          user: run.env.user ?? null,
        }
      : null,
  }
}

/**
 * Maps a raw Trigger.dev attempt object to the normalized attempt shape.
 */
export function mapTriggerDevAttempt(attempt: TriggerDevApiAttempt): TriggerDevAttempt {
  return {
    id: attempt.id,
    status: attempt.status,
    createdAt: attempt.createdAt ?? null,
    updatedAt: attempt.updatedAt ?? null,
    startedAt: attempt.startedAt ?? null,
    completedAt: attempt.completedAt ?? null,
    error: attempt.error
      ? {
          message: attempt.error.message ?? null,
          name: attempt.error.name ?? null,
          stackTrace: attempt.error.stackTrace ?? null,
        }
      : null,
  }
}

/**
 * Maps a raw Trigger.dev run detail object (retrieve and reschedule responses)
 * to the normalized run detail shape.
 */
export function mapTriggerDevRunDetail(run: TriggerDevApiRunDetail): TriggerDevRunDetail {
  return {
    ...mapTriggerDevRunSummary(run),
    metadata: run.metadata ?? null,
    depth: run.depth ?? null,
    batchId: run.batchId ?? null,
    triggerFunction: run.triggerFunction ?? null,
    payload: run.payload ?? null,
    payloadPresignedUrl: run.payloadPresignedUrl ?? null,
    output: run.output ?? null,
    outputPresignedUrl: run.outputPresignedUrl ?? null,
    schedule: run.schedule
      ? {
          id: run.schedule.id ?? null,
          externalId: run.schedule.externalId ?? null,
          deduplicationKey: run.schedule.deduplicationKey ?? null,
          generator: run.schedule.generator
            ? {
                type: run.schedule.generator.type ?? null,
                expression: run.schedule.generator.expression ?? null,
                description: run.schedule.generator.description ?? null,
              }
            : null,
        }
      : null,
    attempts: (run.attempts ?? []).map(mapTriggerDevAttempt),
    relatedRuns: run.relatedRuns
      ? {
          root: run.relatedRuns.root ? mapTriggerDevRunSummary(run.relatedRuns.root) : null,
          parent: run.relatedRuns.parent ? mapTriggerDevRunSummary(run.relatedRuns.parent) : null,
          children: (run.relatedRuns.children ?? []).map(mapTriggerDevRunSummary),
        }
      : null,
  }
}

/**
 * Maps a raw Trigger.dev queue object to the normalized queue shape.
 */
export function mapTriggerDevQueue(queue: TriggerDevApiQueue): TriggerDevQueue {
  return {
    id: queue.id,
    name: queue.name,
    type: queue.type ?? null,
    running: queue.running ?? null,
    queued: queue.queued ?? null,
    paused: queue.paused ?? false,
    concurrencyLimit: queue.concurrencyLimit ?? null,
    concurrency: queue.concurrency
      ? {
          current: queue.concurrency.current ?? null,
          base: queue.concurrency.base ?? null,
          override: queue.concurrency.override ?? null,
          overriddenAt: queue.concurrency.overriddenAt ?? null,
        }
      : null,
  }
}

/**
 * Maps a raw Trigger.dev schedule object to the normalized schedule shape.
 */
export function mapTriggerDevSchedule(schedule: TriggerDevApiSchedule): TriggerDevSchedule {
  return {
    id: schedule.id,
    task: schedule.task,
    type: schedule.type ?? null,
    active: schedule.active ?? false,
    deduplicationKey: schedule.deduplicationKey ?? null,
    externalId: schedule.externalId ?? null,
    cron: schedule.generator?.expression ?? null,
    cronDescription: schedule.generator?.description ?? null,
    timezone: schedule.timezone ?? null,
    nextRun: schedule.nextRun ?? null,
    environments: (schedule.environments ?? []).map((environment) => ({
      id: environment.id ?? null,
      type: environment.type ?? null,
      userName: environment.userName ?? null,
    })),
  }
}

/**
 * Output property schema for a normalized run summary, shared by the run tools.
 */
export const TRIGGER_DEV_RUN_SUMMARY_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique ID of the run (starts with run_)' },
  status: {
    type: 'string',
    description:
      'Run status (PENDING_VERSION, DELAYED, QUEUED, EXECUTING, REATTEMPTING, FROZEN, COMPLETED, CANCELED, FAILED, CRASHED, INTERRUPTED, or SYSTEM_FAILURE)',
  },
  taskIdentifier: { type: 'string', description: 'Identifier of the task the run executes' },
  version: {
    type: 'string',
    description: 'Worker version the run executes on',
    optional: true,
    nullable: true,
  },
  idempotencyKey: {
    type: 'string',
    description: 'Idempotency key the run was triggered with',
    optional: true,
    nullable: true,
  },
  isTest: { type: 'boolean', description: 'Whether the run is a test run' },
  createdAt: {
    type: 'string',
    description: 'ISO timestamp when the run was created',
    nullable: true,
  },
  updatedAt: {
    type: 'string',
    description: 'ISO timestamp when the run was last updated',
    nullable: true,
  },
  startedAt: {
    type: 'string',
    description: 'ISO timestamp when the run started executing',
    optional: true,
    nullable: true,
  },
  finishedAt: {
    type: 'string',
    description: 'ISO timestamp when the run finished',
    optional: true,
    nullable: true,
  },
  delayedUntil: {
    type: 'string',
    description: 'ISO timestamp the run is delayed until',
    optional: true,
    nullable: true,
  },
  ttl: {
    type: 'string',
    description: 'Time-to-live before an unstarted run expires',
    optional: true,
    nullable: true,
  },
  expiredAt: {
    type: 'string',
    description: 'ISO timestamp when the run expired',
    optional: true,
    nullable: true,
  },
  tags: {
    type: 'array',
    description: 'Tags attached to the run',
    items: { type: 'string', description: 'Run tag' },
  },
  costInCents: {
    type: 'number',
    description: 'Compute cost of the run in cents',
    optional: true,
    nullable: true,
  },
  baseCostInCents: {
    type: 'number',
    description: 'Base invocation cost of the run in cents',
    optional: true,
    nullable: true,
  },
  durationMs: {
    type: 'number',
    description: 'Compute duration of the run in milliseconds',
    optional: true,
    nullable: true,
  },
  env: {
    type: 'object',
    description: 'Environment the run executes in',
    optional: true,
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Environment ID', nullable: true },
      name: { type: 'string', description: 'Environment name', nullable: true },
      user: { type: 'string', description: 'Username for dev environments', nullable: true },
    },
  },
}

/**
 * Output schema for a normalized schedule, shared by the schedule tools.
 */
export const TRIGGER_DEV_SCHEDULE_OUTPUTS: NonNullable<ToolConfig['outputs']> = {
  id: { type: 'string', description: 'Unique ID of the schedule (starts with sched_)' },
  task: { type: 'string', description: 'Identifier of the task the schedule triggers' },
  type: {
    type: 'string',
    description: 'Schedule type (DECLARATIVE or IMPERATIVE)',
    optional: true,
  },
  active: { type: 'boolean', description: 'Whether the schedule is active' },
  deduplicationKey: {
    type: 'string',
    description: 'Deduplication key of the schedule',
    optional: true,
  },
  externalId: {
    type: 'string',
    description: 'External ID associated with the schedule',
    optional: true,
  },
  cron: { type: 'string', description: 'Cron expression of the schedule', optional: true },
  cronDescription: {
    type: 'string',
    description: 'Human-readable description of the cron expression',
    optional: true,
  },
  timezone: { type: 'string', description: 'IANA timezone of the schedule', optional: true },
  nextRun: {
    type: 'string',
    description: 'ISO timestamp of the next scheduled run',
    optional: true,
  },
  environments: {
    type: 'array',
    description: 'Environments the schedule runs in',
    items: {
      type: 'object',
      description: 'Environment the schedule is associated with',
      properties: {
        id: { type: 'string', description: 'Environment ID', nullable: true },
        type: { type: 'string', description: 'Environment type', nullable: true },
        userName: { type: 'string', description: 'Username for dev environments', nullable: true },
      },
    },
  },
}

/**
 * Output schema for a normalized run detail, shared by the get run and
 * reschedule run tools.
 */
export const TRIGGER_DEV_RUN_DETAIL_OUTPUTS: NonNullable<ToolConfig['outputs']> = {
  ...TRIGGER_DEV_RUN_SUMMARY_PROPERTIES,
  metadata: {
    type: 'json',
    description: 'Metadata attached to the run',
    optional: true,
  },
  depth: {
    type: 'number',
    description: 'Depth of the run in a parent-child run hierarchy',
    optional: true,
  },
  batchId: {
    type: 'string',
    description: 'ID of the batch the run belongs to, if batch-triggered',
    optional: true,
  },
  triggerFunction: {
    type: 'string',
    description:
      'Function used to trigger the run (trigger, triggerAndWait, batchTrigger, or batchTriggerAndWait)',
    optional: true,
  },
  payload: {
    type: 'json',
    description: 'Payload the run was triggered with',
    optional: true,
  },
  payloadPresignedUrl: {
    type: 'string',
    description: 'Presigned URL to download the payload when it is too large to inline',
    optional: true,
  },
  output: {
    type: 'json',
    description: 'Output returned by the run',
    optional: true,
  },
  outputPresignedUrl: {
    type: 'string',
    description: 'Presigned URL to download the output when it is too large to inline',
    optional: true,
  },
  schedule: {
    type: 'object',
    description: 'Schedule that triggered the run, if any',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Schedule ID', nullable: true },
      externalId: { type: 'string', description: 'External ID of the schedule', nullable: true },
      deduplicationKey: {
        type: 'string',
        description: 'Deduplication key of the schedule',
        nullable: true,
      },
      generator: {
        type: 'object',
        description: 'Schedule generator details',
        nullable: true,
        properties: {
          type: { type: 'string', description: 'Generator type (e.g., CRON)', nullable: true },
          expression: { type: 'string', description: 'Cron expression', nullable: true },
          description: {
            type: 'string',
            description: 'Human-readable description of the cron expression',
            nullable: true,
          },
        },
      },
    },
  },
  attempts: {
    type: 'array',
    description: 'Attempts made for the run',
    items: {
      type: 'object',
      description: 'Run attempt',
      properties: {
        id: { type: 'string', description: 'Attempt ID (starts with attempt_)' },
        status: {
          type: 'string',
          description:
            'Attempt status (PENDING, EXECUTING, PAUSED, COMPLETED, FAILED, or CANCELED)',
        },
        createdAt: {
          type: 'string',
          description: 'ISO timestamp when the attempt was created',
          nullable: true,
        },
        updatedAt: {
          type: 'string',
          description: 'ISO timestamp when the attempt was last updated',
          nullable: true,
        },
        startedAt: {
          type: 'string',
          description: 'ISO timestamp when the attempt started',
          nullable: true,
        },
        completedAt: {
          type: 'string',
          description: 'ISO timestamp when the attempt completed',
          nullable: true,
        },
        error: {
          type: 'object',
          description: 'Error details when the attempt failed',
          nullable: true,
          properties: {
            message: { type: 'string', description: 'Error message', nullable: true },
            name: { type: 'string', description: 'Error name', nullable: true },
            stackTrace: { type: 'string', description: 'Error stack trace', nullable: true },
          },
        },
      },
    },
  },
  relatedRuns: {
    type: 'object',
    description: 'Root, parent, and child runs related to this run',
    optional: true,
    properties: {
      root: {
        type: 'object',
        description: 'Root run of the hierarchy',
        nullable: true,
        properties: TRIGGER_DEV_RUN_SUMMARY_PROPERTIES,
      },
      parent: {
        type: 'object',
        description: 'Parent run of this run',
        nullable: true,
        properties: TRIGGER_DEV_RUN_SUMMARY_PROPERTIES,
      },
      children: {
        type: 'array',
        description: 'Child runs of this run',
        items: {
          type: 'object',
          description: 'Child run',
          properties: TRIGGER_DEV_RUN_SUMMARY_PROPERTIES,
        },
      },
    },
  },
}

/**
 * Output schema for a normalized queue, shared by the queue tools.
 */
export const TRIGGER_DEV_QUEUE_OUTPUTS: NonNullable<ToolConfig['outputs']> = {
  id: { type: 'string', description: 'Unique ID of the queue (starts with queue_)' },
  name: { type: 'string', description: 'Name of the queue' },
  type: {
    type: 'string',
    description: 'Queue type (task for task-default queues, custom for named queues)',
    optional: true,
  },
  running: { type: 'number', description: 'Number of runs currently executing', optional: true },
  queued: { type: 'number', description: 'Number of runs waiting in the queue', optional: true },
  paused: { type: 'boolean', description: 'Whether the queue is paused' },
  concurrencyLimit: {
    type: 'number',
    description: 'Maximum number of runs that can execute concurrently',
    optional: true,
  },
  concurrency: {
    type: 'object',
    description: 'Concurrency details for the queue',
    optional: true,
    properties: {
      current: { type: 'number', description: 'Current concurrency limit', nullable: true },
      base: { type: 'number', description: 'Base concurrency limit', nullable: true },
      override: { type: 'number', description: 'Overridden concurrency limit', nullable: true },
      overriddenAt: {
        type: 'string',
        description: 'ISO timestamp when the concurrency limit was overridden',
        nullable: true,
      },
    },
  },
}
