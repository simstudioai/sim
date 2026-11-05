import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { isValidTimezone } from '@/lib/core/utils/timezone'
import {
  HOME_CALENDAR_ATTENDEE_LIMIT,
  HOME_CALENDAR_EVENT_LIMIT,
  HOME_EMAIL_THREAD_LIMIT,
  HOME_TEXT_LIMITS,
  HOME_WORKSPACE_ACTIVITY_LIMIT,
} from '@/lib/organizations/home/limits'

const paramsSchema = z.object({ id: organizationIdSchema })

const homeWidgetAccountSchema = z.object({
  credentialId: z.string().min(1).max(128),
  displayName: z.string().max(512),
  /**
   * What this read found for the account. `not_offered` means the organization or the viewer's
   * permission group no longer allows the provider, and `not_read` that the account fell past the
   * per-read account limit.
   */
  state: z.enum(['ready', 'needs_reauth', 'not_offered', 'unavailable', 'not_read']),
})
export type HomeWidgetAccount = z.output<typeof homeWidgetAccountSchema>

const homeEmailThreadSchema = z.object({
  id: z.string().min(1).max(512),
  credentialId: z.string().min(1).max(128),
  sender: z.string().max(HOME_TEXT_LIMITS.name),
  subject: z.string().max(HOME_TEXT_LIMITS.title),
  excerpt: z.string().max(HOME_TEXT_LIMITS.excerpt),
  receivedAt: z.iso.datetime(),
  /** Messages in the thread, when the provider groups them and there is more than one. */
  messageCount: z.number().int().min(2).optional(),
  url: z.string().url().max(2048),
})

export const getOrganizationHomeEmailContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/home/email',
  params: paramsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      accounts: z.array(homeWidgetAccountSchema),
      threads: z.array(homeEmailThreadSchema).max(HOME_EMAIL_THREAD_LIMIT),
    }),
  },
})
export type OrganizationHomeEmail = z.output<
  typeof getOrganizationHomeEmailContract.response.schema
>

const homeCalendarEventSchema = z.object({
  id: z.string().min(1).max(1024),
  credentialId: z.string().min(1).max(128),
  title: z.string().max(HOME_TEXT_LIMITS.title),
  allDay: z.boolean(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  url: z.string().url().max(2048).optional(),
  people: z
    .array(z.object({ name: z.string().max(HOME_TEXT_LIMITS.name) }))
    .max(HOME_CALENDAR_ATTENDEE_LIMIT),
})

export const getOrganizationHomeCalendarContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/home/calendar',
  params: paramsSchema,
  query: z.object({
    date: z.iso.date({ error: 'Expected a calendar date in YYYY-MM-DD form' }),
    timeZone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimezone, 'Expected an IANA timezone such as America/Los_Angeles'),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      accounts: z.array(homeWidgetAccountSchema),
      /** The instants that bound the requested day in the requested zone. */
      window: z.object({ startAt: z.iso.datetime(), endAt: z.iso.datetime() }),
      events: z.array(homeCalendarEventSchema).max(HOME_CALENDAR_EVENT_LIMIT),
    }),
  },
})
export type OrganizationHomeCalendar = z.output<
  typeof getOrganizationHomeCalendarContract.response.schema
>

const homeWorkspaceActivitySchema = z.object({
  workspaceId: workspaceIdSchema,
  /**
   * `review`: a run in the workspace is paused on a person's response. `running`: a run is executing
   * within its deadline. Null when neither holds, which says nothing about whether work is current.
   */
  status: z.enum(['review', 'running']).nullable(),
  /** The workflow `status` is about. Null with no status, or when its row is gone. */
  statusWorkflowName: z.string().nullable(),
  /** The newest retained run. Null when log retention holds none, which is not "never ran". */
  lastRun: z
    .object({
      workflowName: z.string().nullable(),
      startedAt: z.iso.datetime(),
      failed: z.boolean(),
    })
    .nullable(),
})

export const getOrganizationHomeWorkspaceActivityContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/home/workspace-activity',
  params: paramsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspaces: z.array(homeWorkspaceActivitySchema).max(HOME_WORKSPACE_ACTIVITY_LIMIT),
    }),
  },
})
export type OrganizationHomeWorkspaceActivity = z.output<
  typeof getOrganizationHomeWorkspaceActivityContract.response.schema
>
