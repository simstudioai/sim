import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const googleSelectors = {
  'google.tasks.lists': {
    key: 'google.tasks.lists',
    contracts: [selectorContracts.googleTasksTaskListsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.tasks.lists',
      context.oauthCredential ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.tasks.lists')
      const data = await requestJson(selectorContracts.googleTasksTaskListsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.taskLists || []).map((tl) => ({ id: tl.id, label: tl.title }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'google.tasks.lists')
      const data = await requestJson(selectorContracts.googleTasksTaskListsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      const tl = (data.taskLists || []).find((t) => t.id === detailId) ?? null
      if (!tl) return null
      return { id: tl.id, label: tl.title }
    },
  },
  'gmail.labels': {
    key: 'gmail.labels',
    contracts: [selectorContracts.gmailLabelsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'gmail.labels',
      context.oauthCredential ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'gmail.labels')
      const data = await requestJson(selectorContracts.gmailLabelsSelectorContract, {
        query: {
          credentialId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.labels || []).map((label) => ({
        id: label.id,
        label: label.name,
      }))
    },
  },
  'google.calendar': {
    key: 'google.calendar',
    contracts: [selectorContracts.googleCalendarSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.calendar',
      context.oauthCredential ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.calendar')
      const data = await requestJson(selectorContracts.googleCalendarSelectorContract, {
        query: {
          credentialId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.calendars || []).map((calendar) => ({
        id: calendar.id,
        label: calendar.summary,
      }))
    },
  },
  'google.drive': {
    key: 'google.drive',
    contracts: [
      selectorContracts.googleDriveFilesSelectorContract,
      selectorContracts.googleDriveFileSelectorContract,
    ],
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'google.drive',
      context.oauthCredential ?? 'none',
      context.mimeType ?? 'any',
      context.fileId ?? 'root',
      search ?? '',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.drive')
      const data = await requestJson(selectorContracts.googleDriveFilesSelectorContract, {
        query: {
          credentialId,
          mimeType: context.mimeType,
          parentId: context.fileId,
          query: search,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'google.drive')
      const data = await requestJson(selectorContracts.googleDriveFileSelectorContract, {
        query: {
          credentialId,
          fileId: detailId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      const file = data.file
      if (!file) return null
      return { id: file.id, label: file.name }
    },
  },
  'google.sheets': {
    key: 'google.sheets',
    contracts: [selectorContracts.googleSheetsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.sheets',
      context.oauthCredential ?? 'none',
      context.spreadsheetId ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.spreadsheetId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.sheets')
      if (!context.spreadsheetId) {
        throw new Error('Missing spreadsheet ID for google.sheets selector')
      }
      const data = await requestJson(selectorContracts.googleSheetsSelectorContract, {
        query: {
          credentialId,
          spreadsheetId: context.spreadsheetId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.sheets || []).map((sheet) => ({
        id: sheet.id,
        label: sheet.name,
      }))
    },
  },
} satisfies Record<
  Extract<
    SelectorKey,
    'google.tasks.lists' | 'gmail.labels' | 'google.calendar' | 'google.drive' | 'google.sheets'
  >,
  SelectorDefinition
>
