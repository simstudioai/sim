'use client'

import { AdminPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/admin-panel'
import {
  ADMIN_PAGE_SIZE,
  useDirectorySearch,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/directory-search'
import { useLiveAdminConsole } from '@/platform/lib/data/admin-console'

/** The Admin section on live data, through the admin queries and mutations. */
export function LiveAdminPanel({ benchmarkAvailable }: { benchmarkAvailable: boolean }) {
  const [{ q, offset }] = useDirectorySearch()
  const admin = useLiveAdminConsole({ q, offset, limit: ADMIN_PAGE_SIZE }, benchmarkAvailable)
  return <AdminPanel console={admin} />
}
