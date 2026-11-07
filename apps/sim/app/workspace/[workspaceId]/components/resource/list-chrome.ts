import type { ComponentType } from 'react'
import {
  Database,
  Download,
  File,
  FolderPlus,
  Library,
  Plus,
  RefreshCw,
  Table,
  Upload,
} from '@sim/emcn/icons'
import { FOLDERED_RESOURCE_HEADERS } from '@/app/workspace/[workspaceId]/components/folders/foldered-resources'
import type { ChromeActionSpec } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'
import type { ResourceColumn } from '@/app/workspace/[workspaceId]/components/resource/resource'

interface ListChrome {
  title: string
  icon: ComponentType<{ className?: string }>
  columns: readonly ResourceColumn[]
  actions: readonly ChromeActionSpec[]
  searchPlaceholder: string
  hasSort: boolean
  hasFilter: boolean
}

/** The original list chrome used for loading and for fixture rendering of a workspace page. */
export const RESOURCE_LIST_CHROME = {
  tables: {
    title: FOLDERED_RESOURCE_HEADERS.table.rootLabel,
    icon: Table,
    columns: [
      { id: 'name', header: 'Name' },
      { id: 'columns', header: 'Columns' },
      { id: 'rows', header: 'Rows' },
      { id: 'created', header: 'Created' },
      { id: 'owner', header: 'Owner' },
      { id: 'updated', header: 'Last Updated' },
    ],
    actions: [
      { text: 'Import CSV', icon: Upload },
      { text: 'New folder', icon: FolderPlus },
      { text: 'New table', icon: Plus, variant: 'primary' },
    ],
    searchPlaceholder: 'Search tables...',
    hasSort: true,
    hasFilter: true,
  },
  files: {
    title: FOLDERED_RESOURCE_HEADERS.file.rootLabel,
    icon: File,
    columns: [
      { id: 'name', header: 'Name', widthMultiplier: 1.15 },
      { id: 'size', header: 'Size', widthMultiplier: 0.85 },
      { id: 'type', header: 'Type', widthMultiplier: 1.0 },
      { id: 'created', header: 'Created' },
      { id: 'owner', header: 'Owner' },
      { id: 'updated', header: 'Last Updated' },
    ],
    actions: [
      { text: 'Upload', icon: Upload },
      { text: 'New folder', icon: FolderPlus },
      { text: 'New file', icon: Plus, variant: 'primary' },
    ],
    searchPlaceholder: 'Search files...',
    hasSort: true,
    hasFilter: true,
  },
  knowledge: {
    title: FOLDERED_RESOURCE_HEADERS.knowledge_base.rootLabel,
    icon: Database,
    columns: [
      { id: 'name', header: 'Name' },
      { id: 'documents', header: 'Documents', widthMultiplier: 0.6 },
      { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
      { id: 'connectors', header: 'Connectors', widthMultiplier: 0.7 },
      { id: 'created', header: 'Created' },
      { id: 'owner', header: 'Owner' },
      { id: 'updated', header: 'Last Updated' },
    ],
    actions: [
      { text: 'New folder', icon: FolderPlus },
      { text: 'New base', icon: Plus, variant: 'primary' },
    ],
    searchPlaceholder: 'Search knowledge bases...',
    hasSort: true,
    hasFilter: true,
  },
  logs: {
    title: 'Logs',
    icon: Library,
    columns: [
      { id: 'workflow', header: 'Workflow' },
      { id: 'date', header: 'Date' },
      { id: 'status', header: 'Status' },
      { id: 'cost', header: 'Cost' },
      { id: 'trigger', header: 'Trigger' },
      { id: 'duration', header: 'Duration' },
    ],
    actions: [
      { text: 'Export', icon: Download },
      { text: 'Refresh', icon: RefreshCw },
      { text: 'Logs', active: true },
      { text: 'Dashboard' },
    ],
    searchPlaceholder: 'Search logs...',
    hasSort: true,
    hasFilter: true,
  },
} as const satisfies Record<string, ListChrome>
