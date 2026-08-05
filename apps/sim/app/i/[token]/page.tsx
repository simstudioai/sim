import { cache } from 'react'
import { db } from '@sim/db'
import { workflow, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { InterfaceLayout, InterfaceModule } from '@/lib/interfaces'
import { moduleReference } from '@/lib/interfaces'
import { buildProvenance } from '@/lib/public-shares/provenance'
import { resolvePublicShareGate } from '@/lib/public-shares/share-gate'
import { resolveActiveInterfaceShareByToken } from '@/lib/public-shares/share-manager'
import { getTableById } from '@/lib/table'
import { LogoShell } from '@/app/(landing)/components'
import { PublicInterfaceView } from '@/app/i/[token]/components'
import { getBrandConfig } from '@/ee/whitelabeling'
import type { InterfaceModuleSeed, ResourceSeed } from '@/resources'

export const dynamic = 'force-dynamic'

/** Deduped per-request so `generateMetadata` and the page share one DB resolve. */
const resolveShare = cache(resolveActiveInterfaceShareByToken)

/** Shared links must never be indexed by search engines. */
const NOINDEX = { index: false, follow: false } as const

interface PublicInterfacePageProps {
  params: Promise<{ token: string }>
}

/**
 * Social-preview metadata. Public shares unfurl with the interface name +
 * provenance; any protected share (password / email / SSO) stays deliberately
 * generic so the interface name never leaks before the visitor authenticates.
 * Always `noindex`.
 */
export async function generateMetadata({ params }: PublicInterfacePageProps): Promise<Metadata> {
  const { token } = await params
  const resolved = await resolveShare(token)
  if (!resolved) {
    return { robots: NOINDEX }
  }

  let title: string
  let description: string
  if (resolved.share.authType !== 'public') {
    title = 'Shared interface'
    description = 'Authentication is required to use this interface.'
  } else {
    title = resolved.definition.name
    description =
      buildProvenance(resolved.workspaceName, resolved.ownerName) || `Shared interface · ${title}`
  }

  const brand = getBrandConfig()
  return {
    title,
    description,
    robots: NOINDEX,
    openGraph: { type: 'website', title, description, siteName: brand.name },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * A module the visitor may actually use, with the resource the server resolved
 * for it. Chat and form modules carry no seed: their surfaces are fully
 * described by the module config the layout already sends, and each run is
 * authorized per request by the token-scoped route — surviving this pass is the
 * only thing the client needs to know about them.
 */
interface UsableModule {
  module: InterfaceModule
  seed: InterfaceModuleSeed | null
}

/**
 * Re-derives a module's one resource from the stored config and proves it still
 * lives in the interface's workspace, returning the payload the client needs to
 * render it — or `null` when the module must be pruned.
 *
 * The workspace re-check is not redundant with layout validation:
 * `validateLayout` grandfathers references it has already seen, so a stored
 * reference is only proven in-workspace at the moment it was introduced.
 *
 * Chat and form modules additionally require a deployed workflow. Publicly
 * there is no session, so the draft state is unreachable and both public
 * execute paths demand deployment — a visitor must never be handed a composer
 * that dies on first send, nor be told "not deployed", which is internal
 * workspace state.
 */
async function resolveUsableModule(
  module: InterfaceModule,
  workspaceId: string
): Promise<UsableModule | null> {
  const reference = moduleReference(module)
  if (!reference) return null

  switch (module.type) {
    case 'chat':
    case 'form': {
      const [row] = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(
          and(
            eq(workflow.id, reference.id),
            eq(workflow.workspaceId, workspaceId),
            isNull(workflow.archivedAt),
            eq(workflow.isDeployed, true)
          )
        )
        .limit(1)
      return row ? { module, seed: null } : null
    }
    case 'table': {
      const table = await getTableById(reference.id)
      if (!table || table.workspaceId !== workspaceId || table.archivedAt) return null
      return {
        module,
        seed: { kind: 'table', seed: { name: table.name, columns: table.schema.columns } },
      }
    }
    case 'file': {
      const [row] = await db
        .select({
          originalName: workspaceFiles.originalName,
          contentType: workspaceFiles.contentType,
          size: workspaceFiles.size,
          updatedAt: workspaceFiles.updatedAt,
        })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.id, reference.id),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .limit(1)
      return row
        ? {
            module,
            seed: {
              kind: 'file',
              seed: {
                name: row.originalName,
                type: row.contentType,
                size: row.size,
                /**
                 * The file's `updatedAt` doubles as a content version, busting
                 * the viewer's caches when the shared file changes.
                 */
                version: row.updatedAt.getTime(),
              },
            },
          }
        : null
    }
  }
}

/**
 * Drops the workspace resource id a module's config carries before the layout
 * crosses to the browser. Every share read is addressed by `(token, moduleId)`,
 * so the ids are dead weight on this page — and a workflow, table, or file id
 * on an anonymous surface is internal workspace state disclosed for nothing.
 *
 * Surviving {@link resolveUsableModule} is what proves a module is wired; the
 * id it was wired to is not the client's business.
 */
function withoutResourceIds(module: InterfaceModule): InterfaceModule {
  switch (module.type) {
    case 'chat':
      return { ...module, config: { ...module.config, workflowId: null } }
    case 'form':
      return { ...module, config: { ...module.config, workflowId: null } }
    case 'table':
      return { ...module, config: { ...module.config, tableId: null } }
    case 'file':
      return { ...module, config: { ...module.config, fileId: null } }
  }
}

/**
 * Public page for a shared interface.
 *
 * The layout handed to the client is pruned to the modules a visitor can
 * actually use, so the client never receives a module it is not authorized to
 * render. Pruning (rather than rendering "unavailable" panels) also keeps the
 * interface's internal wiring problems invisible: `collapseLayout` collapses
 * the grid around whatever remains, so a two-module interface whose table was
 * deleted becomes a clean full-page chat.
 */
export default async function PublicInterfacePage({ params }: PublicInterfacePageProps) {
  const { token } = await params

  const resolved = await resolveShare(token)
  if (!resolved) {
    notFound()
  }

  const { share, definition, workspaceId, ownerName } = resolved

  const gate = await resolvePublicShareGate('interface', token, share)
  if (gate) return gate

  const resolvedModules = await Promise.all(
    definition.layout.modules.map((module) => resolveUsableModule(module, workspaceId))
  )
  const usable = resolvedModules.filter((entry): entry is UsableModule => entry !== null)

  if (usable.length === 0) {
    return (
      <LogoShell center>
        <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
          <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
            Interface unavailable
          </h1>
          <p className='text-[var(--text-muted)] text-lg'>
            This interface isn&apos;t set up yet. Check back later.
          </p>
        </div>
      </LogoShell>
    )
  }

  /**
   * The authored grid is carried through unchanged — pruning removes modules,
   * never tracks. `collapseLayout` is what drops the tracks nothing occupies
   * once the survivors are known.
   */
  const layout: InterfaceLayout = {
    ...definition.layout,
    modules: usable.map((entry) => withoutResourceIds(entry.module)),
  }
  const modules: Record<string, InterfaceModuleSeed> = {}
  for (const entry of usable) {
    if (entry.seed) modules[entry.module.id] = entry.seed
  }

  const seed: ResourceSeed<'interface'> = { name: definition.name, layout, modules }

  return <PublicInterfaceView token={token} seed={seed} ownerName={ownerName} />
}
