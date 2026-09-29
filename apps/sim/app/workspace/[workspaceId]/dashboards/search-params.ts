import { parseAsString } from 'nuqs/server'
import {
  folderNavParsers,
  folderNavUrlKeys,
} from '@/app/workspace/[workspaceId]/components/folders/search-params'

export const dashboardBrowserParsers = {
  folderId: folderNavParsers.folderId.withOptions(folderNavUrlKeys),
  search: parseAsString.withDefault(''),
}
