import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const microsoftSelectors = {
  'microsoft.planner.plans': {
    key: 'microsoft.planner.plans',
    contracts: [selectorContracts.microsoftPlannerPlansSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.planner.plans',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.planner.plans')
      const data = await requestJson(selectorContracts.microsoftPlannerPlansSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.plans || []).map((plan) => ({ id: plan.id, label: plan.title }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'microsoft.planner.plans')
      const data = await requestJson(selectorContracts.microsoftPlannerPlansSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const plan = (data.plans || []).find((p) => p.id === detailId) ?? null
      if (!plan) return null
      return { id: plan.id, label: plan.title }
    },
  },
  'outlook.folders': {
    key: 'outlook.folders',
    contracts: [selectorContracts.outlookFoldersSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'outlook.folders',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'outlook.folders')
      const data = await requestJson(selectorContracts.outlookFoldersSelectorContract, {
        query: { credentialId },
        signal,
      })
      return (data.folders || []).map((folder) => ({
        id: folder.id,
        label: folder.name,
      }))
    },
  },
  'microsoft.teams': {
    key: 'microsoft.teams',
    contracts: [selectorContracts.microsoftTeamsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.teams',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.teams')
      const data = await requestJson(selectorContracts.microsoftTeamsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.teams || []).map((team) => ({
        id: team.id,
        label: team.displayName,
      }))
    },
  },
  'microsoft.chats': {
    key: 'microsoft.chats',
    contracts: [selectorContracts.microsoftChatsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.chats',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.chats')
      const data = await requestJson(selectorContracts.microsoftChatsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.chats || []).map((chat) => ({
        id: chat.id,
        label: chat.displayName,
      }))
    },
  },
  'microsoft.channels': {
    key: 'microsoft.channels',
    contracts: [selectorContracts.microsoftChannelsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.channels',
      context.oauthCredential ?? 'none',
      context.teamId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.teamId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.channels')
      if (!context.teamId) {
        throw new Error('Missing team ID for microsoft.channels selector')
      }
      const data = await requestJson(selectorContracts.microsoftChannelsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          teamId: context.teamId,
        },
        signal,
      })
      return (data.channels || []).map((channel) => ({
        id: channel.id,
        label: channel.displayName,
      }))
    },
  },
  'microsoft.planner': {
    key: 'microsoft.planner',
    contracts: [selectorContracts.microsoftPlannerTasksSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.planner',
      context.oauthCredential ?? 'none',
      context.planId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.planId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.planner')
      if (!context.planId) {
        throw new Error('Missing plan ID for microsoft.planner selector')
      }
      const data = await requestJson(selectorContracts.microsoftPlannerTasksSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          planId: context.planId,
        },
        signal,
      })
      return (data.tasks || []).map((task) => ({
        id: task.id,
        label: task.title,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId || !context.planId) return null
      const credentialId = ensureCredential(context, 'microsoft.planner')
      const data = await requestJson(selectorContracts.microsoftPlannerTasksSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          planId: context.planId,
        },
        signal,
      })
      const task = (data.tasks || []).find((t) => t.id === detailId) ?? null
      if (!task) return null
      return { id: task.id, label: task.title }
    },
  },
  'onedrive.files': {
    key: 'onedrive.files',
    contracts: [selectorContracts.onedriveFilesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'onedrive.files',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'onedrive.files')
      const data = await requestJson(selectorContracts.onedriveFilesSelectorContract, {
        query: { credentialId },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'onedrive.folders': {
    key: 'onedrive.folders',
    contracts: [selectorContracts.onedriveFoldersSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'onedrive.folders',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'onedrive.folders')
      const data = await requestJson(selectorContracts.onedriveFoldersSelectorContract, {
        query: { credentialId },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'microsoft.excel.sheets': {
    key: 'microsoft.excel.sheets',
    contracts: [selectorContracts.microsoftExcelSheetsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.excel.sheets',
      context.oauthCredential ?? 'none',
      context.spreadsheetId ?? 'none',
      context.driveId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.spreadsheetId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.excel.sheets')
      if (!context.spreadsheetId) {
        throw new Error('Missing spreadsheet ID for microsoft.excel.sheets selector')
      }
      const data = await requestJson(selectorContracts.microsoftExcelSheetsSelectorContract, {
        query: {
          credentialId,
          spreadsheetId: context.spreadsheetId,
          driveId: context.driveId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.sheets || []).map((sheet) => ({
        id: sheet.id,
        label: sheet.name,
      }))
    },
  },
  'microsoft.excel.drives': {
    key: 'microsoft.excel.drives',
    contracts: [
      selectorContracts.microsoftExcelDrivesSelectorContract,
      selectorContracts.microsoftExcelDriveSelectorContract,
    ],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.excel.drives',
      context.oauthCredential ?? 'none',
      context.siteId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.siteId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.excel.drives')
      if (!context.siteId) {
        throw new Error('Missing site ID for microsoft.excel.drives selector')
      }
      const data = await requestJson(selectorContracts.microsoftExcelDrivesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          siteId: context.siteId,
        },
        signal,
      })
      return data.drives.map((drive) => ({
        id: drive.id,
        label: drive.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId || !context.siteId) return null
      const credentialId = ensureCredential(context, 'microsoft.excel.drives')
      const data = await requestJson(selectorContracts.microsoftExcelDriveSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          siteId: context.siteId,
          driveId: detailId,
        },
        signal,
      })
      const { drive } = data
      if (!drive) return null
      return { id: drive.id, label: drive.name }
    },
  },
  'microsoft.excel': {
    key: 'microsoft.excel',
    contracts: [selectorContracts.microsoftFilesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.excel',
      context.oauthCredential ?? 'none',
      context.driveId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.excel')
      const data = await requestJson(selectorContracts.microsoftFilesSelectorContract, {
        query: {
          credentialId,
          query: search,
          driveId: context.driveId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'microsoft.word': {
    key: 'microsoft.word',
    contracts: [selectorContracts.microsoftFilesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.word',
      context.oauthCredential ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.word')
      const data = await requestJson(selectorContracts.microsoftFilesSelectorContract, {
        query: {
          credentialId,
          query: search,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
} satisfies Record<
  Extract<
    SelectorKey,
    | 'microsoft.planner.plans'
    | 'outlook.folders'
    | 'microsoft.teams'
    | 'microsoft.chats'
    | 'microsoft.channels'
    | 'microsoft.planner'
    | 'onedrive.files'
    | 'onedrive.folders'
    | 'microsoft.excel.sheets'
    | 'microsoft.excel.drives'
    | 'microsoft.excel'
    | 'microsoft.word'
  >,
  SelectorDefinition
>
