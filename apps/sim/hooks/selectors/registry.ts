import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { fetchJson, fetchOAuthToken } from '@/hooks/selectors/helpers'
import { selectorKeys } from '@/hooks/selectors/query-keys'
import type {
  SelectorContext,
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

const SELECTOR_STALE = 60 * 1000

type AirtableBase = { id: string; name: string }
type AirtableTable = { id: string; name: string }
type AsanaWorkspace = { id: string; name: string }
type AttioObject = { id: string; name: string }
type AttioList = { id: string; name: string }
type BigQueryDataset = {
  datasetReference: { datasetId: string; projectId: string }
  friendlyName?: string
}
type BigQueryTable = { tableReference: { tableId: string }; friendlyName?: string }
type CalcomEventType = { id: string; title: string; slug: string }
type ConfluenceSpace = { id: string; name: string; key: string }
type JsmServiceDesk = { id: string; name: string }
type JsmRequestType = { id: string; name: string }
type NotionDatabase = { id: string; name: string }
type NotionPage = { id: string; name: string }
type PipedrivePipeline = { id: string; name: string }
type ZoomMeeting = { id: string; name: string }
type CalcomSchedule = { id: string; name: string }
type GoogleTaskList = { id: string; title: string }
type PlannerPlan = { id: string; title: string }
type SharepointList = { id: string; displayName: string }
type TrelloBoard = { id: string; name: string; closed?: boolean }
type SlackChannel = { id: string; name: string }
type SlackUser = { id: string; name: string; real_name: string }
type FolderResponse = { id: string; name: string }
type PlannerTask = { id: string; title: string }

const ensureCredential = (context: SelectorContext, key: SelectorKey): string => {
  if (!context.oauthCredential) {
    throw new Error(`Missing credential for selector ${key}`)
  }
  return context.oauthCredential
}

const ensureDomain = (context: SelectorContext, key: SelectorKey): string => {
  if (!context.domain) {
    throw new Error(`Missing domain for selector ${key}`)
  }
  return context.domain
}

const ensureKnowledgeBase = (context: SelectorContext): string => {
  if (!context.knowledgeBaseId) {
    throw new Error('Missing knowledge base id')
  }
  return context.knowledgeBaseId
}

const registry: Record<SelectorKey, SelectorDefinition> = {
  'airtable.bases': {
    key: 'airtable.bases',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'airtable.bases',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'airtable.bases')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ bases: AirtableBase[] }>('/api/tools/airtable/bases', {
        method: 'POST',
        body,
      })
      return (data.bases || []).map((base) => ({
        id: base.id,
        label: base.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'airtable.bases')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        baseId: detailId,
      })
      const data = await fetchJson<{ bases: AirtableBase[] }>('/api/tools/airtable/bases', {
        method: 'POST',
        body,
      })
      const base = (data.bases || []).find((b) => b.id === detailId) ?? null
      if (!base) return null
      return { id: base.id, label: base.name }
    },
  },
  'airtable.tables': {
    key: 'airtable.tables',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'airtable.tables',
      context.oauthCredential ?? 'none',
      context.baseId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.baseId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'airtable.tables')
      if (!context.baseId) {
        throw new Error('Missing base ID for airtable.tables selector')
      }
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        baseId: context.baseId,
      })
      const data = await fetchJson<{ tables: AirtableTable[] }>('/api/tools/airtable/tables', {
        method: 'POST',
        body,
      })
      return (data.tables || []).map((table) => ({
        id: table.id,
        label: table.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'airtable.tables')
      if (!context.baseId) return null
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        baseId: context.baseId,
      })
      const data = await fetchJson<{ tables: AirtableTable[] }>('/api/tools/airtable/tables', {
        method: 'POST',
        body,
      })
      const table = (data.tables || []).find((t) => t.id === detailId) ?? null
      if (!table) return null
      return { id: table.id, label: table.name }
    },
  },
  'asana.workspaces': {
    key: 'asana.workspaces',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'asana.workspaces',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'asana.workspaces')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ workspaces: AsanaWorkspace[] }>(
        '/api/tools/asana/workspaces',
        { method: 'POST', body }
      )
      return (data.workspaces || []).map((ws) => ({ id: ws.id, label: ws.name }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'asana.workspaces')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ workspaces: AsanaWorkspace[] }>(
        '/api/tools/asana/workspaces',
        { method: 'POST', body }
      )
      const ws = (data.workspaces || []).find((w) => w.id === detailId) ?? null
      if (!ws) return null
      return { id: ws.id, label: ws.name }
    },
  },
  'attio.objects': {
    key: 'attio.objects',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'attio.objects',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'attio.objects')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ objects: AttioObject[] }>('/api/tools/attio/objects', {
        method: 'POST',
        body,
      })
      return (data.objects || []).map((obj) => ({
        id: obj.id,
        label: obj.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'attio.objects')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ objects: AttioObject[] }>('/api/tools/attio/objects', {
        method: 'POST',
        body,
      })
      const obj = (data.objects || []).find((o) => o.id === detailId) ?? null
      if (!obj) return null
      return { id: obj.id, label: obj.name }
    },
  },
  'attio.lists': {
    key: 'attio.lists',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'attio.lists',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'attio.lists')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ lists: AttioList[] }>('/api/tools/attio/lists', {
        method: 'POST',
        body,
      })
      return (data.lists || []).map((list) => ({
        id: list.id,
        label: list.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'attio.lists')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ lists: AttioList[] }>('/api/tools/attio/lists', {
        method: 'POST',
        body,
      })
      const list = (data.lists || []).find((l) => l.id === detailId) ?? null
      if (!list) return null
      return { id: list.id, label: list.name }
    },
  },
  'bigquery.datasets': {
    key: 'bigquery.datasets',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'bigquery.datasets',
      context.oauthCredential ?? 'none',
      context.projectId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.projectId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'bigquery.datasets')
      if (!context.projectId) throw new Error('Missing project ID for bigquery.datasets selector')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        projectId: context.projectId,
      })
      const data = await fetchJson<{ datasets: BigQueryDataset[] }>(
        '/api/tools/google_bigquery/datasets',
        { method: 'POST', body }
      )
      return (data.datasets || []).map((ds) => ({
        id: ds.datasetReference.datasetId,
        label: ds.friendlyName || ds.datasetReference.datasetId,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId || !context.projectId) return null
      const credentialId = ensureCredential(context, 'bigquery.datasets')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        projectId: context.projectId,
      })
      const data = await fetchJson<{ datasets: BigQueryDataset[] }>(
        '/api/tools/google_bigquery/datasets',
        { method: 'POST', body }
      )
      const ds =
        (data.datasets || []).find((d) => d.datasetReference.datasetId === detailId) ?? null
      if (!ds) return null
      return {
        id: ds.datasetReference.datasetId,
        label: ds.friendlyName || ds.datasetReference.datasetId,
      }
    },
  },
  'bigquery.tables': {
    key: 'bigquery.tables',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'bigquery.tables',
      context.oauthCredential ?? 'none',
      context.projectId ?? 'none',
      context.datasetId ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && context.projectId && context.datasetId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'bigquery.tables')
      if (!context.projectId) throw new Error('Missing project ID for bigquery.tables selector')
      if (!context.datasetId) throw new Error('Missing dataset ID for bigquery.tables selector')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        projectId: context.projectId,
        datasetId: context.datasetId,
      })
      const data = await fetchJson<{ tables: BigQueryTable[] }>(
        '/api/tools/google_bigquery/tables',
        { method: 'POST', body }
      )
      return (data.tables || []).map((t) => ({
        id: t.tableReference.tableId,
        label: t.friendlyName || t.tableReference.tableId,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId || !context.projectId || !context.datasetId) return null
      const credentialId = ensureCredential(context, 'bigquery.tables')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        projectId: context.projectId,
        datasetId: context.datasetId,
      })
      const data = await fetchJson<{ tables: BigQueryTable[] }>(
        '/api/tools/google_bigquery/tables',
        { method: 'POST', body }
      )
      const t = (data.tables || []).find((tbl) => tbl.tableReference.tableId === detailId) ?? null
      if (!t) return null
      return { id: t.tableReference.tableId, label: t.friendlyName || t.tableReference.tableId }
    },
  },
  'calcom.eventTypes': {
    key: 'calcom.eventTypes',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'calcom.eventTypes',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'calcom.eventTypes')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ eventTypes: CalcomEventType[] }>(
        '/api/tools/calcom/event-types',
        { method: 'POST', body }
      )
      return (data.eventTypes || []).map((et) => ({
        id: et.id,
        label: et.title || et.slug,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'calcom.eventTypes')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ eventTypes: CalcomEventType[] }>(
        '/api/tools/calcom/event-types',
        { method: 'POST', body }
      )
      const et = (data.eventTypes || []).find((e) => e.id === detailId) ?? null
      if (!et) return null
      return { id: et.id, label: et.title || et.slug }
    },
  },
  'calcom.schedules': {
    key: 'calcom.schedules',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'calcom.schedules',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'calcom.schedules')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ schedules: CalcomSchedule[] }>('/api/tools/calcom/schedules', {
        method: 'POST',
        body,
      })
      return (data.schedules || []).map((s) => ({
        id: s.id,
        label: s.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'calcom.schedules')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ schedules: CalcomSchedule[] }>('/api/tools/calcom/schedules', {
        method: 'POST',
        body,
      })
      const s = (data.schedules || []).find((sc) => sc.id === detailId) ?? null
      if (!s) return null
      return { id: s.id, label: s.name }
    },
  },
  'confluence.spaces': {
    key: 'confluence.spaces',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'confluence.spaces',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'confluence.spaces')
      const domain = ensureDomain(context, 'confluence.spaces')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        domain,
      })
      const data = await fetchJson<{ spaces: ConfluenceSpace[] }>(
        '/api/tools/confluence/selector-spaces',
        { method: 'POST', body }
      )
      return (data.spaces || []).map((space) => ({
        id: space.id,
        label: `${space.name} (${space.key})`,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'confluence.spaces')
      const domain = ensureDomain(context, 'confluence.spaces')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        domain,
      })
      const data = await fetchJson<{ spaces: ConfluenceSpace[] }>(
        '/api/tools/confluence/selector-spaces',
        { method: 'POST', body }
      )
      const space = (data.spaces || []).find((s) => s.id === detailId) ?? null
      if (!space) return null
      return { id: space.id, label: `${space.name} (${space.key})` }
    },
  },
  'jsm.serviceDesks': {
    key: 'jsm.serviceDesks',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'jsm.serviceDesks',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jsm.serviceDesks')
      const domain = ensureDomain(context, 'jsm.serviceDesks')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        domain,
      })
      const data = await fetchJson<{ serviceDesks: JsmServiceDesk[] }>(
        '/api/tools/jsm/selector-servicedesks',
        { method: 'POST', body }
      )
      return (data.serviceDesks || []).map((sd) => ({
        id: sd.id,
        label: sd.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jsm.serviceDesks')
      const domain = ensureDomain(context, 'jsm.serviceDesks')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        domain,
      })
      const data = await fetchJson<{ serviceDesks: JsmServiceDesk[] }>(
        '/api/tools/jsm/selector-servicedesks',
        { method: 'POST', body }
      )
      const sd = (data.serviceDesks || []).find((s) => s.id === detailId) ?? null
      if (!sd) return null
      return { id: sd.id, label: sd.name }
    },
  },
  'jsm.requestTypes': {
    key: 'jsm.requestTypes',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'jsm.requestTypes',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      context.serviceDeskId ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && context.domain && context.serviceDeskId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jsm.requestTypes')
      const domain = ensureDomain(context, 'jsm.requestTypes')
      if (!context.serviceDeskId) throw new Error('Missing serviceDeskId for jsm.requestTypes')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        domain,
        serviceDeskId: context.serviceDeskId,
      })
      const data = await fetchJson<{ requestTypes: JsmRequestType[] }>(
        '/api/tools/jsm/selector-requesttypes',
        { method: 'POST', body }
      )
      return (data.requestTypes || []).map((rt) => ({
        id: rt.id,
        label: rt.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jsm.requestTypes')
      const domain = ensureDomain(context, 'jsm.requestTypes')
      if (!context.serviceDeskId) return null
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        domain,
        serviceDeskId: context.serviceDeskId,
      })
      const data = await fetchJson<{ requestTypes: JsmRequestType[] }>(
        '/api/tools/jsm/selector-requesttypes',
        { method: 'POST', body }
      )
      const rt = (data.requestTypes || []).find((r) => r.id === detailId) ?? null
      if (!rt) return null
      return { id: rt.id, label: rt.name }
    },
  },
  'google.tasks.lists': {
    key: 'google.tasks.lists',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.tasks.lists',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.tasks.lists')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ taskLists: GoogleTaskList[] }>(
        '/api/tools/google_tasks/task-lists',
        { method: 'POST', body }
      )
      return (data.taskLists || []).map((tl) => ({ id: tl.id, label: tl.title }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'google.tasks.lists')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ taskLists: GoogleTaskList[] }>(
        '/api/tools/google_tasks/task-lists',
        { method: 'POST', body }
      )
      const tl = (data.taskLists || []).find((t) => t.id === detailId) ?? null
      if (!tl) return null
      return { id: tl.id, label: tl.title }
    },
  },
  'microsoft.planner.plans': {
    key: 'microsoft.planner.plans',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.planner.plans',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.planner.plans')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ plans: PlannerPlan[] }>('/api/tools/microsoft_planner/plans', {
        method: 'POST',
        body,
      })
      return (data.plans || []).map((plan) => ({ id: plan.id, label: plan.title }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'microsoft.planner.plans')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ plans: PlannerPlan[] }>('/api/tools/microsoft_planner/plans', {
        method: 'POST',
        body,
      })
      const plan = (data.plans || []).find((p) => p.id === detailId) ?? null
      if (!plan) return null
      return { id: plan.id, label: plan.title }
    },
  },
  'notion.databases': {
    key: 'notion.databases',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'notion.databases',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'notion.databases')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ databases: NotionDatabase[] }>('/api/tools/notion/databases', {
        method: 'POST',
        body,
      })
      return (data.databases || []).map((db) => ({
        id: db.id,
        label: db.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'notion.databases')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ databases: NotionDatabase[] }>('/api/tools/notion/databases', {
        method: 'POST',
        body,
      })
      const db = (data.databases || []).find((d) => d.id === detailId) ?? null
      if (!db) return null
      return { id: db.id, label: db.name }
    },
  },
  'notion.pages': {
    key: 'notion.pages',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'notion.pages',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'notion.pages')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ pages: NotionPage[] }>('/api/tools/notion/pages', {
        method: 'POST',
        body,
      })
      return (data.pages || []).map((page) => ({
        id: page.id,
        label: page.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'notion.pages')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ pages: NotionPage[] }>('/api/tools/notion/pages', {
        method: 'POST',
        body,
      })
      const page = (data.pages || []).find((p) => p.id === detailId) ?? null
      if (!page) return null
      return { id: page.id, label: page.name }
    },
  },
  'pipedrive.pipelines': {
    key: 'pipedrive.pipelines',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'pipedrive.pipelines',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'pipedrive.pipelines')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ pipelines: PipedrivePipeline[] }>(
        '/api/tools/pipedrive/pipelines',
        { method: 'POST', body }
      )
      return (data.pipelines || []).map((p) => ({
        id: p.id,
        label: p.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'pipedrive.pipelines')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ pipelines: PipedrivePipeline[] }>(
        '/api/tools/pipedrive/pipelines',
        { method: 'POST', body }
      )
      const p = (data.pipelines || []).find((pl) => pl.id === detailId) ?? null
      if (!p) return null
      return { id: p.id, label: p.name }
    },
  },
  'sharepoint.lists': {
    key: 'sharepoint.lists',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'sharepoint.lists',
      context.oauthCredential ?? 'none',
      context.siteId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.siteId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'sharepoint.lists')
      if (!context.siteId) throw new Error('Missing site ID for sharepoint.lists selector')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        siteId: context.siteId,
      })
      const data = await fetchJson<{ lists: SharepointList[] }>('/api/tools/sharepoint/lists', {
        method: 'POST',
        body,
      })
      return (data.lists || []).map((list) => ({ id: list.id, label: list.displayName }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId || !context.siteId) return null
      const credentialId = ensureCredential(context, 'sharepoint.lists')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        siteId: context.siteId,
      })
      const data = await fetchJson<{ lists: SharepointList[] }>('/api/tools/sharepoint/lists', {
        method: 'POST',
        body,
      })
      const list = (data.lists || []).find((l) => l.id === detailId) ?? null
      if (!list) return null
      return { id: list.id, label: list.displayName }
    },
  },
  'trello.boards': {
    key: 'trello.boards',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'trello.boards',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'trello.boards')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ boards: TrelloBoard[] }>('/api/tools/trello/boards', {
        method: 'POST',
        body,
      })
      return (data.boards || [])
        .filter((board) => !board.closed)
        .map((board) => ({ id: board.id, label: board.name }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'trello.boards')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ boards: TrelloBoard[] }>('/api/tools/trello/boards', {
        method: 'POST',
        body,
      })
      const board = (data.boards || []).find((b) => b.id === detailId) ?? null
      if (!board) return null
      return { id: board.id, label: board.name }
    },
  },
  'zoom.meetings': {
    key: 'zoom.meetings',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'zoom.meetings',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'zoom.meetings')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ meetings: ZoomMeeting[] }>('/api/tools/zoom/meetings', {
        method: 'POST',
        body,
      })
      return (data.meetings || []).map((m) => ({
        id: m.id,
        label: m.name || `Meeting ${m.id}`,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'zoom.meetings')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ meetings: ZoomMeeting[] }>('/api/tools/zoom/meetings', {
        method: 'POST',
        body,
      })
      const meeting = (data.meetings || []).find((m) => m.id === detailId) ?? null
      if (!meeting) return null
      return { id: meeting.id, label: meeting.name || `Meeting ${meeting.id}` }
    },
  },
  'slack.channels': {
    key: 'slack.channels',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.channels',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({
        credential: context.oauthCredential,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ channels: SlackChannel[] }>('/api/tools/slack/channels', {
        method: 'POST',
        body,
      })
      return (data.channels || []).map((channel) => ({
        id: channel.id,
        label: `#${channel.name}`,
      }))
    },
  },
  'slack.users': {
    key: 'slack.users',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.users',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({
        credential: context.oauthCredential,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ users: SlackUser[] }>('/api/tools/slack/users', {
        method: 'POST',
        body,
      })
      return (data.users || []).map((user) => ({
        id: user.id,
        label: user.real_name || user.name,
      }))
    },
  },
  'gmail.labels': {
    key: 'gmail.labels',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'gmail.labels',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ labels: FolderResponse[] }>('/api/tools/gmail/labels', {
        searchParams: { credentialId: context.oauthCredential },
      })
      return (data.labels || []).map((label) => ({
        id: label.id,
        label: label.name,
      }))
    },
  },
  'outlook.folders': {
    key: 'outlook.folders',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'outlook.folders',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ folders: FolderResponse[] }>('/api/tools/outlook/folders', {
        searchParams: { credentialId: context.oauthCredential },
      })
      return (data.folders || []).map((folder) => ({
        id: folder.id,
        label: folder.name,
      }))
    },
  },
  'google.calendar': {
    key: 'google.calendar',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.calendar',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ calendars: { id: string; summary: string }[] }>(
        '/api/tools/google_calendar/calendars',
        { searchParams: { credentialId: context.oauthCredential } }
      )
      return (data.calendars || []).map((calendar) => ({
        id: calendar.id,
        label: calendar.summary,
      }))
    },
  },
  'microsoft.teams': {
    key: 'microsoft.teams',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.teams',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({ credential: context.oauthCredential })
      const data = await fetchJson<{ teams: { id: string; displayName: string }[] }>(
        '/api/tools/microsoft-teams/teams',
        { method: 'POST', body }
      )
      return (data.teams || []).map((team) => ({
        id: team.id,
        label: team.displayName,
      }))
    },
  },
  'microsoft.chats': {
    key: 'microsoft.chats',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.chats',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({ credential: context.oauthCredential })
      const data = await fetchJson<{ chats: { id: string; displayName: string }[] }>(
        '/api/tools/microsoft-teams/chats',
        { method: 'POST', body }
      )
      return (data.chats || []).map((chat) => ({
        id: chat.id,
        label: chat.displayName,
      }))
    },
  },
  'microsoft.channels': {
    key: 'microsoft.channels',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.channels',
      context.oauthCredential ?? 'none',
      context.teamId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.teamId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({
        credential: context.oauthCredential,
        teamId: context.teamId,
      })
      const data = await fetchJson<{ channels: { id: string; displayName: string }[] }>(
        '/api/tools/microsoft-teams/channels',
        { method: 'POST', body }
      )
      return (data.channels || []).map((channel) => ({
        id: channel.id,
        label: channel.displayName,
      }))
    },
  },
  'wealthbox.contacts': {
    key: 'wealthbox.contacts',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'wealthbox.contacts',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ items: { id: string; name: string }[] }>(
        '/api/tools/wealthbox/items',
        {
          searchParams: { credentialId: context.oauthCredential, type: 'contact' },
        }
      )
      return (data.items || []).map((item) => ({
        id: item.id,
        label: item.name,
      }))
    },
  },
  'sharepoint.sites': {
    key: 'sharepoint.sites',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'sharepoint.sites',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'sharepoint.sites')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/sharepoint/sites',
        {
          method: 'POST',
          body,
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'sharepoint.sites')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/sharepoint/sites',
        {
          method: 'POST',
          body,
        }
      )
      const site = (data.files || []).find((f) => f.id === detailId) ?? null
      if (!site) return null
      return { id: site.id, label: site.name }
    },
  },
  'microsoft.planner': {
    key: 'microsoft.planner',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.planner',
      context.oauthCredential ?? 'none',
      context.planId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.planId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.planner')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        planId: context.planId,
      })
      const data = await fetchJson<{ tasks: PlannerTask[] }>('/api/tools/microsoft_planner/tasks', {
        method: 'POST',
        body,
      })
      return (data.tasks || []).map((task) => ({
        id: task.id,
        label: task.title,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'microsoft.planner')
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        planId: context.planId,
      })
      const data = await fetchJson<{ tasks: PlannerTask[] }>('/api/tools/microsoft_planner/tasks', {
        method: 'POST',
        body,
      })
      const task = (data.tasks || []).find((t) => t.id === detailId) ?? null
      if (!task) return null
      return { id: task.id, label: task.title }
    },
  },
  'jira.projects': {
    key: 'jira.projects',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.projects',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{ projects: { id: string; name: string }[] }>(
        '/api/tools/jira/projects',
        {
          searchParams: {
            domain,
            accessToken,
            query: search ?? '',
          },
        }
      )
      return (data.projects || []).map((project) => ({
        id: project.id,
        label: project.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{ project?: { id: string; name: string } }>(
        '/api/tools/jira/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            domain,
            accessToken,
            projectId: detailId,
          }),
        }
      )
      if (!data.project) return null
      return {
        id: data.project.id,
        label: data.project.name,
      }
    },
  },
  'jira.issues': {
    key: 'jira.issues',
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.issues',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      context.projectId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{
        sections?: { issues: { id?: string; key?: string; summary?: string }[] }[]
      }>('/api/tools/jira/issues', {
        searchParams: {
          domain,
          accessToken,
          projectId: context.projectId,
          query: search ?? '',
        },
      })
      const issues =
        data.sections?.flatMap((section) =>
          (section.issues || []).map((issue) => ({
            id: issue.id || issue.key || '',
            name: issue.summary || issue.key || '',
          }))
        ) || []
      return issues
        .filter((issue) => issue.id)
        .map((issue) => ({ id: issue.id, label: issue.name || issue.id }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{ issues?: { id: string; name: string }[] }>(
        '/api/tools/jira/issues',
        {
          method: 'POST',
          body: JSON.stringify({
            domain,
            accessToken,
            issueKeys: [detailId],
          }),
        }
      )
      const issue = data.issues?.[0]
      if (!issue) return null
      return { id: issue.id, label: issue.name }
    },
  },
  'linear.teams': {
    key: 'linear.teams',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'linear.teams',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'linear.teams')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ teams: { id: string; name: string }[] }>(
        '/api/tools/linear/teams',
        {
          method: 'POST',
          body,
        }
      )
      return (data.teams || []).map((team) => ({
        id: team.id,
        label: team.name,
      }))
    },
  },
  'linear.projects': {
    key: 'linear.projects',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'linear.projects',
      context.oauthCredential ?? 'none',
      context.teamId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.teamId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'linear.projects')
      const body = JSON.stringify({
        credential: credentialId,
        teamId: context.teamId,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ projects: { id: string; name: string }[] }>(
        '/api/tools/linear/projects',
        {
          method: 'POST',
          body,
        }
      )
      return (data.projects || []).map((project) => ({
        id: project.id,
        label: project.name,
      }))
    },
  },
  'confluence.pages': {
    key: 'confluence.pages',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'confluence.pages',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'confluence.pages')
      const domain = ensureDomain(context, 'confluence.pages')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Confluence access token')
      }
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/confluence/pages',
        {
          method: 'POST',
          body: JSON.stringify({
            domain,
            accessToken,
            title: search,
          }),
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'confluence.pages')
      const domain = ensureDomain(context, 'confluence.pages')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Confluence access token')
      }
      const data = await fetchJson<{ id: string; title: string }>('/api/tools/confluence/page', {
        method: 'POST',
        body: JSON.stringify({
          domain,
          accessToken,
          pageId: detailId,
        }),
      })
      return { id: data.id, label: data.title }
    },
  },
  'onedrive.files': {
    key: 'onedrive.files',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'onedrive.files',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'onedrive.files')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/onedrive/files',
        {
          searchParams: { credentialId },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'onedrive.folders': {
    key: 'onedrive.folders',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'onedrive.folders',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'onedrive.folders')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/onedrive/folders',
        {
          searchParams: { credentialId },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'google.drive': {
    key: 'google.drive',
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'google.drive',
      context.oauthCredential ?? 'none',
      context.mimeType ?? 'any',
      context.fileId ?? 'root',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.drive')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/drive/files',
        {
          searchParams: {
            credentialId,
            mimeType: context.mimeType,
            parentId: context.fileId,
            query: search,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'google.drive')
      const data = await fetchJson<{ file?: { id: string; name: string } }>(
        '/api/tools/drive/file',
        {
          searchParams: {
            credentialId,
            fileId: detailId,
            workflowId: context.workflowId,
          },
        }
      )
      const file = data.file
      if (!file) return null
      return { id: file.id, label: file.name }
    },
  },
  'google.sheets': {
    key: 'google.sheets',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.sheets',
      context.oauthCredential ?? 'none',
      context.spreadsheetId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.spreadsheetId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.sheets')
      if (!context.spreadsheetId) {
        throw new Error('Missing spreadsheet ID for google.sheets selector')
      }
      const data = await fetchJson<{ sheets: { id: string; name: string }[] }>(
        '/api/tools/google_sheets/sheets',
        {
          searchParams: {
            credentialId,
            spreadsheetId: context.spreadsheetId,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.sheets || []).map((sheet) => ({
        id: sheet.id,
        label: sheet.name,
      }))
    },
  },
  'microsoft.excel.sheets': {
    key: 'microsoft.excel.sheets',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.excel.sheets',
      context.oauthCredential ?? 'none',
      context.spreadsheetId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.spreadsheetId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.excel.sheets')
      if (!context.spreadsheetId) {
        throw new Error('Missing spreadsheet ID for microsoft.excel.sheets selector')
      }
      const data = await fetchJson<{ sheets: { id: string; name: string }[] }>(
        '/api/tools/microsoft_excel/sheets',
        {
          searchParams: {
            credentialId,
            spreadsheetId: context.spreadsheetId,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.sheets || []).map((sheet) => ({
        id: sheet.id,
        label: sheet.name,
      }))
    },
  },
  'microsoft.excel': {
    key: 'microsoft.excel',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.excel',
      context.oauthCredential ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.excel')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/auth/oauth/microsoft/files',
        {
          searchParams: {
            credentialId,
            query: search,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'microsoft.word': {
    key: 'microsoft.word',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.word',
      context.oauthCredential ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.word')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/auth/oauth/microsoft/files',
        {
          searchParams: {
            credentialId,
            query: search,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'knowledge.documents': {
    key: 'knowledge.documents',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'knowledge.documents',
      context.knowledgeBaseId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.knowledgeBaseId),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const data = await fetchJson<{
        data?: { documents: { id: string; filename: string }[] }
      }>(`/api/knowledge/${knowledgeBaseId}/documents`, {
        searchParams: {
          limit: 200,
          search,
        },
      })
      const documents = data.data?.documents || []
      return documents.map((doc) => ({
        id: doc.id,
        label: doc.filename,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const data = await fetchJson<{ data?: { document?: { id: string; filename: string } } }>(
        `/api/knowledge/${knowledgeBaseId}/documents/${detailId}`,
        {
          searchParams: { includeDisabled: 'true' },
        }
      )
      const doc = data.data?.document
      if (!doc) return null
      return { id: doc.id, label: doc.filename }
    },
  },
  'webflow.sites': {
    key: 'webflow.sites',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'webflow.sites',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'webflow.sites')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ sites: { id: string; name: string }[] }>(
        '/api/tools/webflow/sites',
        {
          method: 'POST',
          body,
        }
      )
      return (data.sites || []).map((site) => ({
        id: site.id,
        label: site.name,
      }))
    },
  },
  'webflow.collections': {
    key: 'webflow.collections',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'webflow.collections',
      context.oauthCredential ?? 'none',
      context.siteId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.siteId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'webflow.collections')
      if (!context.siteId) {
        throw new Error('Missing site ID for webflow.collections selector')
      }
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        siteId: context.siteId,
      })
      const data = await fetchJson<{ collections: { id: string; name: string }[] }>(
        '/api/tools/webflow/collections',
        {
          method: 'POST',
          body,
        }
      )
      return (data.collections || []).map((collection) => ({
        id: collection.id,
        label: collection.name,
      }))
    },
  },
  'webflow.items': {
    key: 'webflow.items',
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'webflow.items',
      context.oauthCredential ?? 'none',
      context.collectionId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.collectionId),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'webflow.items')
      if (!context.collectionId) {
        throw new Error('Missing collection ID for webflow.items selector')
      }
      const body = JSON.stringify({
        credential: credentialId,
        workflowId: context.workflowId,
        collectionId: context.collectionId,
        search,
      })
      const data = await fetchJson<{ items: { id: string; name: string }[] }>(
        '/api/tools/webflow/items',
        {
          method: 'POST',
          body,
        }
      )
      return (data.items || []).map((item) => ({
        id: item.id,
        label: item.name,
      }))
    },
  },
  'sim.workflows': {
    key: 'sim.workflows',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) =>
      context.workspaceId
        ? selectorKeys.simWorkflows(context.workspaceId, context.excludeWorkflowId)
        : [...selectorKeys.all, 'sim.workflows', 'none', context.excludeWorkflowId ?? 'none'],
    enabled: ({ context }) => Boolean(context.workspaceId),
    fetchList: async ({ context }: SelectorQueryArgs): Promise<SelectorOption[]> => {
      if (!context.workspaceId) return []
      await getQueryClient().ensureQueryData(getWorkflowListQueryOptions(context.workspaceId))
      const workflows = getWorkflows(context.workspaceId)
      return workflows
        .filter((w) => w.id !== context.excludeWorkflowId)
        .map((w) => ({
          id: w.id,
          label: w.name || `Workflow ${w.id.slice(0, 8)}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs): Promise<SelectorOption | null> => {
      if (!detailId || !context.workspaceId) return null
      await getQueryClient().ensureQueryData(getWorkflowListQueryOptions(context.workspaceId))
      const workflow = getWorkflowById(context.workspaceId, detailId)
      if (!workflow) return null
      return {
        id: detailId,
        label: workflow.name || `Workflow ${detailId.slice(0, 8)}`,
      }
    },
  },
}

export function getSelectorDefinition(key: SelectorKey): SelectorDefinition {
  const definition = registry[key]
  if (!definition) {
    throw new Error(`Missing selector definition for ${key}`)
  }
  return definition
}

export function mergeOption(options: SelectorOption[], option?: SelectorOption | null) {
  if (!option) return options
  if (options.some((item) => item.id === option.id)) {
    return options
  }
  return [option, ...options]
}
