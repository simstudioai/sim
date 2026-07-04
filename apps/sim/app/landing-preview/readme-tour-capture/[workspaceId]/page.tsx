'use client'

import { Suspense, use, useEffect, useRef, useState } from 'react'
import { ToastProvider } from '@sim/emcn'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { Files } from '@/app/workspace/[workspaceId]/files/files'
import { Home } from '@/app/workspace/[workspaceId]/home/home'
import { Integrations } from '@/app/workspace/[workspaceId]/integrations/integrations'
import { Knowledge } from '@/app/workspace/[workspaceId]/knowledge/knowledge'
import Logs from '@/app/workspace/[workspaceId]/logs/logs'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { SandboxWorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Tables } from '@/app/workspace/[workspaceId]/tables/tables'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import { SocketProvider } from '@/app/workspace/providers/socket-provider'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { connectorKeys } from '@/hooks/queries/kb/connectors'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { logKeys } from '@/hooks/queries/logs'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { sessionKeys } from '@/hooks/queries/session'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * TEMPORARY README tour-capture route — the REAL Sim workspace (genuine
 * WorkspaceChrome sidebar) with the main view switched IN PLACE as the capture
 * cursor clicks sidebar nav items, so one continuous screencast shows a user
 * navigating chat → integrations → knowledge → tables → files → workflow → logs.
 * No auth/network (everything seeded), light mode. Not committed.
 */
export const dynamic = 'force-dynamic'

const FRAME_BG = '#F8F8F8'
const CARD_BG = '#FFFFFF'
const CARD_W = 1180
const CARD_H = 720
const WS_ID = 'demo'
const WS_NAME = 'Brightwave'
const USER = { id: 'demo-user', name: 'Sam Rivera', email: 'sam@brightwave.com', image: null }
const CHAT_ID = 'demo-chat-1'
const WF_ID = 'wf1'
const KB_ID = 'kb-pricing'

type View = 'chat' | 'integrations' | 'knowledge' | 'tables' | 'files' | 'logs' | 'workflow'

const PDF = 'application/pdf'
const DOC_TOKENS = [12400, 23100, 4300, 15800, 9200]

const DEMO_WORKFLOW: WorkflowState = {
  currentWorkflowId: WF_ID,
  blocks: {
    start: {
      id: 'start',
      type: 'start_trigger',
      name: 'Start',
      position: { x: 170, y: 60 },
      subBlocks: { inputFormat: { id: 'inputFormat', type: 'input-format', value: null } },
      outputs: {},
      enabled: true,
      horizontalHandles: false,
      height: 0,
    },
    agent: {
      id: 'agent',
      type: 'agent',
      name: 'Enrich lead',
      position: { x: 140, y: 260 },
      subBlocks: {
        model: { id: 'model', type: 'dropdown', value: 'claude-opus-4-1' },
        systemPrompt: {
          id: 'systemPrompt',
          type: 'long-input',
          value: 'Enrich the lead with firmographics and a fit score.',
        },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: false,
      height: 0,
    },
    slack: {
      id: 'slack',
      type: 'slack',
      name: 'Post to #sales',
      position: { x: 160, y: 540 },
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: 'send' },
        channel: { id: 'channel', type: 'short-input', value: '#sales' },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: false,
      height: 0,
    },
  },
  edges: [
    {
      id: 'e1',
      source: 'start',
      target: 'agent',
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'workflowEdge',
      data: {},
    },
    {
      id: 'e2',
      source: 'agent',
      target: 'slack',
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'workflowEdge',
      data: {},
    },
  ],
  loops: {},
  parallels: {},
  lastSaved: Date.now(),
}

function makeKb(
  id: string,
  name: string,
  description: string,
  docCount: number,
  tokenCount: number,
  connectorTypes: string[],
  iso: string
) {
  return {
    id,
    userId: USER.id,
    name,
    description,
    tokenCount,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
    workspaceId: WS_ID,
    docCount,
    connectorTypes,
  }
}

function seed(qc: QueryClient) {
  if (typeof document !== 'undefined')
    document.documentElement.style.setProperty('--sidebar-width', `${SIDEBAR_WIDTH.DEFAULT}px`)
  qc.setQueryDefaults(sessionKeys.detail(), { staleTime: Number.POSITIVE_INFINITY })
  qc.setQueryData(sessionKeys.detail(), { user: USER, session: { activeOrganizationId: null } })
  qc.setQueryData(workspaceKeys.list('active'), {
    workspaces: [
      {
        id: WS_ID,
        name: WS_NAME,
        color: '#525252',
        ownerId: USER.id,
        organizationId: null,
        workspaceMode: 'personal',
        permissions: 'admin',
        logoUrl: '/landing/rivian-logo.svg',
      },
    ],
    lastActiveWorkspaceId: WS_ID,
    creationPolicy: null,
  })
  qc.setQueryData(workspaceKeys.members(WS_ID), [
    { userId: USER.id, name: USER.name, email: USER.email, image: null, role: 'admin' },
  ])

  const now = new Date()
  const iso = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
  const day = 86_400_000
  qc.setQueryData(workflowKeys.list(WS_ID, 'active'), [
    {
      id: 'wf1',
      name: 'Lead enrichment',
      description: undefined,
      workspaceId: WS_ID,
      folderId: null,
      sortOrder: 0,
      createdAt: now,
      lastModified: now,
      archivedAt: null,
      locked: false,
    },
    {
      id: 'wf2',
      name: 'Inbound lead routing',
      description: undefined,
      workspaceId: WS_ID,
      folderId: null,
      sortOrder: 1,
      createdAt: now,
      lastModified: now,
      archivedAt: null,
      locked: false,
    },
    {
      id: 'wf3',
      name: 'Weekly pipeline report',
      description: undefined,
      workspaceId: WS_ID,
      folderId: null,
      sortOrder: 2,
      createdAt: now,
      lastModified: now,
      archivedAt: null,
      locked: false,
    },
  ])
  qc.setQueryData(folderKeys.list(WS_ID, 'active'), [])
  qc.setQueryData(workspaceCredentialKeys.list(WS_ID), [])
  qc.setQueryData(mothershipChatKeys.list(WS_ID), [
    {
      id: CHAT_ID,
      name: 'Enrich new signups',
      updatedAt: now,
      isActive: false,
      isUnread: false,
      isPinned: false,
    },
    {
      id: 'c2',
      name: 'Post deal alerts to #sales',
      updatedAt: now,
      isActive: false,
      isUnread: false,
      isPinned: false,
    },
  ])

  qc.setQueryData(deploymentKeys.info(WF_ID), {
    isDeployed: false,
    needsRedeployment: false,
    deployedAt: null,
  })
  qc.setQueryData(deploymentKeys.deployedState(WF_ID), DEMO_WORKFLOW)
  useWorkflowStore.getState().setCurrentWorkflowId(WF_ID)
  useWorkflowStore.getState().replaceWorkflowState(DEMO_WORKFLOW)
  useWorkflowRegistry.setState({
    activeWorkflowId: WF_ID,
    hydration: { phase: 'ready', workspaceId: WS_ID, workflowId: WF_ID },
  })

  // Tables
  qc.setQueryData(tableKeys.list(WS_ID, 'active'), [
    {
      id: 'leads',
      name: 'Leads',
      description: 'Sales leads with enrichment',
      schema: {
        columns: [
          { id: 'c_name', name: 'Name', type: 'string' },
          { id: 'c_email', name: 'Email', type: 'email' },
          { id: 'c_company', name: 'Company', type: 'string' },
          { id: 'c_score', name: 'Fit score', type: 'number' },
          { id: 'c_status', name: 'Status', type: 'string' },
        ],
        workflowGroups: [],
      },
      metadata: null,
      rowCount: 128,
      maxRows: 5000,
      workspaceId: WS_ID,
      createdBy: USER.id,
      archivedAt: null,
      createdAt: new Date(now.getTime() - 9 * day),
      updatedAt: now,
    },
    {
      id: 'enriched',
      name: 'Enriched signups',
      description: null,
      schema: {
        columns: [
          { id: 'c_email', name: 'Email', type: 'email' },
          { id: 'c_domain', name: 'Domain', type: 'string' },
          { id: 'c_rev', name: 'Est. revenue', type: 'string' },
        ],
        workflowGroups: [],
      },
      metadata: null,
      rowCount: 342,
      maxRows: 5000,
      workspaceId: WS_ID,
      createdBy: USER.id,
      archivedAt: null,
      createdAt: new Date(now.getTime() - 7 * day),
      updatedAt: new Date(now.getTime() - 2 * day),
    },
    {
      id: 'accounts',
      name: 'Target accounts',
      description: null,
      schema: {
        columns: [
          { id: 'c_acct', name: 'Account', type: 'string' },
          { id: 'c_tier', name: 'Tier', type: 'string' },
          { id: 'c_owner', name: 'Owner', type: 'string' },
        ],
        workflowGroups: [],
      },
      metadata: null,
      rowCount: 64,
      maxRows: 5000,
      workspaceId: WS_ID,
      createdBy: USER.id,
      archivedAt: null,
      createdAt: new Date(now.getTime() - 20 * day),
      updatedAt: new Date(now.getTime() - 5 * day),
    },
  ])

  // Files
  const mkFile = (id: string, name: string, type: string, size: number, days: number) => ({
    id,
    workspaceId: WS_ID,
    name,
    key: `workspace/${WS_ID}/${id}`,
    path: `/serve/workspace/${WS_ID}/${id}`,
    size,
    type,
    uploadedBy: USER.id,
    folderId: null,
    folderPath: null,
    uploadedAt: new Date(now.getTime() - days * day),
    updatedAt: new Date(now.getTime() - days * day),
    storageContext: 'workspace',
    share: null,
  })
  qc.setQueryData(workspaceFilesKeys.list(WS_ID, 'active'), [
    mkFile('file1', 'Pricing & Sales Playbook.pdf', PDF, 2_400_000, 3),
    mkFile('file2', 'Competitor Battlecards.pdf', PDF, 1_800_000, 6),
    mkFile(
      'file3',
      'Q4 Pipeline.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      1_200_000,
      9
    ),
    mkFile(
      'file4',
      'ICP & Account Research.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      640_000,
      14
    ),
  ])
  qc.setQueryData(workspaceFileFolderKeys.list(WS_ID, 'active'), [])

  // Logs
  const logFilters = {
    timeRange: 'All time',
    startDate: undefined,
    endDate: undefined,
    level: 'all',
    workflowIds: [],
    folderIds: [],
    triggers: [],
    searchQuery: '',
    limit: 50,
    sortBy: 'date',
    sortOrder: 'desc',
  }
  const mkLog = (
    id: string,
    status: string,
    level: string,
    duration: string,
    trigger: string,
    mins: number,
    wfName: string,
    wfId: string
  ) => ({
    id,
    workflowId: wfId,
    executionId: `exec-${id}`,
    deploymentVersionId: null,
    deploymentVersion: null,
    deploymentVersionName: null,
    level,
    status,
    duration,
    trigger,
    createdAt: new Date(now.getTime() - mins * 60_000).toISOString(),
    workflow: { id: wfId, name: wfName, description: undefined },
    jobTitle: null,
    cost: { total: 0.0231 },
    pauseSummary: { status: null, total: 0, resumed: 0 },
    hasPendingPause: false,
  })
  qc.setQueryData(logKeys.list(WS_ID, logFilters), {
    pages: [
      {
        logs: [
          mkLog('l1', 'success', 'info', 'PT2.3S', 'webhook', 4, 'Lead enrichment', 'wf1'),
          mkLog('l2', 'success', 'info', 'PT1.9S', 'webhook', 26, 'Lead enrichment', 'wf1'),
          mkLog('l3', 'success', 'info', 'PT3.1S', 'schedule', 92, 'Weekly pipeline report', 'wf3'),
          mkLog('l4', 'error', 'error', 'PT0.8S', 'webhook', 140, 'Inbound lead routing', 'wf2'),
          mkLog('l5', 'success', 'info', 'PT2.6S', 'manual', 180, 'Lead enrichment', 'wf1'),
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  })

  // Knowledge base
  qc.setQueryDefaults(knowledgeKeys.all, {
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
  const pricingTokens = DOC_TOKENS.reduce((a, b) => a + b, 0)
  qc.setQueryData(knowledgeKeys.list(WS_ID, 'active'), [
    makeKb(
      KB_ID,
      'Pricing & Sales Playbooks',
      'Pricing, packaging, and deal-desk references',
      7,
      pricingTokens,
      [],
      iso(6)
    ),
    makeKb(
      'kb-battlecards',
      'Competitor Battlecards',
      'Win/loss intel and objection handling',
      5,
      188000,
      ['google_drive'],
      iso(12)
    ),
    makeKb(
      'kb-icp',
      'ICP & Account Research',
      'Ideal customer profiles and territory notes',
      9,
      142000,
      [],
      iso(20)
    ),
  ])
  qc.setQueryData(knowledgeKeys.tagDefinitions(KB_ID), [])
  qc.setQueryData(connectorKeys.list(KB_ID), [])

  qc.setQueryData(mothershipChatKeys.detail(CHAT_ID), {
    id: CHAT_ID,
    title: 'Enrich new signups',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'When a new lead signs up, enrich it with company data and post it to #sales.',
        timestamp: now.toISOString(),
      },
      {
        id: 'm2',
        role: 'assistant',
        content:
          "On it. I'll build a workflow that enriches each new signup with firmographics, scores it, and posts a summary to your #sales channel in Slack.",
        timestamp: new Date(now.getTime() + 1200).toISOString(),
      },
    ],
    activeStreamId: null,
    resources: [{ type: 'workflow', id: WF_ID, title: 'Lead enrichment' }],
  })
}

interface CapturePageProps {
  searchParams: Promise<{
    w?: string
    h?: string
    view?: string
    cardW?: string
    cardH?: string
    bare?: string
  }>
}

export default function ReadmeTourCapturePage({ searchParams }: CapturePageProps) {
  const params = use(searchParams)
  const camW = Number(params.w ?? 1280)
  const camH = Number(params.h ?? 800)
  const cardW = Number(params.cardW ?? CARD_W)
  const cardH = Number(params.cardH ?? CARD_H)
  const bare = params.bare === '1'
  const queryClient = useQueryClient()
  const { setTheme } = useTheme()
  const [view, setView] = useState<View>((params.view as View) || 'chat')
  const cameraRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useState(() => {
    seed(queryClient)
    return true
  })

  useEffect(() => {
    setTheme('light')
    const prevBody = document.body.style.background
    document.body.style.background = FRAME_BG
    document.documentElement.style.background = FRAME_BG

    // Intercept sidebar nav clicks → switch the in-place view (no real routing).
    const hrefToView = (href: string): View | null => {
      if (/\/integrations(\b|\/|\?)/.test(href)) return 'integrations'
      if (/\/tables(\b|\/|\?)/.test(href)) return 'tables'
      if (/\/files(\b|\/|\?)/.test(href)) return 'files'
      if (/\/knowledge(\b|\/|\?)/.test(href)) return 'knowledge'
      if (/\/logs(\b|\/|\?)/.test(href)) return 'logs'
      if (/\/w\//.test(href)) return 'workflow'
      if (/\/workspace\/[^/]+\/?($|\?)/.test(href) || /\/home(\b|\/|\?)/.test(href)) return 'chat'
      return null
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const v = hrefToView(a.getAttribute('href') || '')
      if (v) {
        e.preventDefault()
        e.stopPropagation()
        setView(v)
      }
    }
    document.addEventListener('click', onClick, true)

    // double-cast-allowed: dev-only capture harness exposes imperative hooks on window for Playwright
    const w = window as unknown as {
      __setCamera?: (s: number, tx: number, ty: number) => void
      __cardSize?: () => { w: number; h: number }
      __deploy?: () => void
      __setView?: (v: View) => void
    }
    w.__setCamera = (s, tx, ty) => {
      const cam = cameraRef.current
      if (cam) cam.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    }
    w.__cardSize = () => ({
      w: cardRef.current?.offsetWidth ?? CARD_W,
      h: cardRef.current?.offsetHeight ?? CARD_H,
    })
    w.__setView = (v) => setView(v)
    w.__deploy = () =>
      queryClient.setQueryData(deploymentKeys.info(WF_ID), {
        isDeployed: true,
        needsRedeployment: false,
        deployedAt: new Date().toISOString(),
      })

    return () => {
      document.body.style.background = prevBody
      document.removeEventListener('click', onClick, true)
      w.__setCamera = undefined
      w.__cardSize = undefined
      w.__deploy = undefined
      w.__setView = undefined
    }
  }, [setTheme, queryClient])

  return (
    <div
      className='light'
      data-capture-stage
      style={{
        width: `${camW}px`,
        height: `${camH}px`,
        background: FRAME_BG,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        ref={cameraRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: 'translate(0px,0px) scale(1)',
        }}
      >
        <div
          ref={cardRef}
          data-app-card
          style={{
            width: `${cardW}px`,
            height: `${cardH}px`,
            background: CARD_BG,
            border: bare ? 'none' : '1px solid #E9E9E9',
            boxShadow: bare ? 'none' : '0px 1px 2px rgba(0,0,0,0.12)',
            borderRadius: bare ? 0 : '24px',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SocketProvider>
            <ToastProvider>
              <GlobalCommandsProvider>
                <SandboxWorkspacePermissionsProvider>
                  <WorkspaceChrome>
                    {view === 'workflow' ? (
                      <Workflow workspaceId={WS_ID} workflowId={WF_ID} sandbox />
                    ) : view === 'integrations' ? (
                      <Suspense fallback={null}>
                        <Integrations />
                      </Suspense>
                    ) : view === 'knowledge' ? (
                      <Suspense fallback={null}>
                        <Knowledge />
                      </Suspense>
                    ) : view === 'tables' ? (
                      <Suspense fallback={null}>
                        <Tables />
                      </Suspense>
                    ) : view === 'files' ? (
                      <Suspense fallback={null}>
                        <Files />
                      </Suspense>
                    ) : view === 'logs' ? (
                      <Suspense fallback={null}>
                        <Logs />
                      </Suspense>
                    ) : (
                      <Suspense fallback={null}>
                        <Home chatId={CHAT_ID} userName={USER.name} userId={USER.id} />
                      </Suspense>
                    )}
                  </WorkspaceChrome>
                </SandboxWorkspacePermissionsProvider>
              </GlobalCommandsProvider>
            </ToastProvider>
          </SocketProvider>
        </div>
      </div>
    </div>
  )
}
