'use client'

import { useQueryState } from 'nuqs'
import {
  forkIdParam,
  forkIdUrlKeys,
  forkSyncDirectionParam,
  forkSyncDirectionUrlKeys,
  forkViewParam,
  forkViewUrlKeys,
} from '@/lib/settings/search-params'

/** The lineage partner whose sync detail is open; only the parent edge has one. */
export function useForkIdParam() {
  return useQueryState(forkIdParam.key, { ...forkIdParam.parser, ...forkIdUrlKeys })
}

/** The workspace-scoped Activity view. */
export function useForkViewParam() {
  return useQueryState(forkViewParam.key, { ...forkViewParam.parser, ...forkViewUrlKeys })
}

/** The open sync detail's direction, shareable so a copied link opens the same side. */
export function useForkSyncDirectionParam() {
  return useQueryState(forkSyncDirectionParam.key, {
    ...forkSyncDirectionParam.parser,
    ...forkSyncDirectionUrlKeys,
  })
}
