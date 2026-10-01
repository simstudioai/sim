import { project, projectWorkspace, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * The write paths that keep every workspace in exactly one project. Each runs inside the
 * transaction that creates, forks or disconnects the workspace, so no committed workspace is
 * ever without a project.
 */

/**
 * A project's name: the name of the workspace that roots it, marked as a project so it reads
 * apart from that workspace. Matches the backfill's naming.
 */
function projectNameFor(workspaceName: string): string {
  return `${workspaceName.trim() || 'Untitled'} - Project`
}

interface NewWorkspace {
  workspaceId: string
  name: string
  organizationId: string | null
}

/** A newly created workspace gets a project of its own, which it roots. */
export async function createProjectForWorkspace(
  tx: DbOrTx,
  { workspaceId, name, organizationId }: NewWorkspace
): Promise<string> {
  const projectId = generateId()
  await tx.insert(project).values({ id: projectId, name: projectNameFor(name), organizationId })
  await tx.insert(projectWorkspace).values({ projectId, workspaceId, position: 0 })
  return projectId
}

interface NewFork extends NewWorkspace {
  parentWorkspaceId: string
}

/**
 * A fork joins its parent's project one step further from the root. A parent with no project
 * (only possible before the backfill has run) makes the fork a project of its own instead.
 */
export async function addForkToParentProject(tx: DbOrTx, fork: NewFork): Promise<string> {
  const [parent] = await tx
    .select({ projectId: projectWorkspace.projectId, position: projectWorkspace.position })
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, fork.parentWorkspaceId))
    .limit(1)
  if (!parent) return createProjectForWorkspace(tx, fork)
  await tx.insert(projectWorkspace).values({
    projectId: parent.projectId,
    workspaceId: fork.workspaceId,
    position: parent.position + 1,
  })
  return parent.projectId
}

/**
 * A disconnected fork leaves its parent's project with every workspace forked from it, into a
 * new project named after it; positions restart from the fork.
 */
export async function moveForkToNewProject(
  tx: DbOrTx,
  forkWorkspaceId: string
): Promise<string | null> {
  const [fork] = await tx
    .select({
      name: workspace.name,
      organizationId: workspace.organizationId,
      projectId: projectWorkspace.projectId,
      position: projectWorkspace.position,
    })
    .from(workspace)
    .innerJoin(projectWorkspace, eq(projectWorkspace.workspaceId, workspace.id))
    .where(eq(workspace.id, forkWorkspaceId))
    .limit(1)
  if (!fork) return null

  /** The fork and its descendants within the same project, following the fork edges down. */
  const subtree = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT ${forkWorkspaceId}::text AS id
      UNION
      SELECT w.id FROM workspace w JOIN descendants d ON w.forked_from_workspace_id = d.id
    )
    SELECT d.id FROM descendants d
    JOIN project_workspace pw ON pw.workspace_id = d.id AND pw.project_id = ${fork.projectId}
  `)
  const ids = [...subtree].map((row) => row.id)
  if (ids.length === 0) return null

  const projectId = generateId()
  await tx.insert(project).values({
    id: projectId,
    name: projectNameFor(fork.name),
    organizationId: fork.organizationId,
  })
  await tx
    .update(projectWorkspace)
    .set({ projectId, position: sql`${projectWorkspace.position} - ${fork.position}` })
    .where(
      and(
        eq(projectWorkspace.projectId, fork.projectId),
        inArray(projectWorkspace.workspaceId, ids)
      )
    )
  return projectId
}

/** A chat started in a workspace records that workspace's project. */
export async function recordChatWorkspaceProject(
  tx: DbOrTx,
  chatId: string,
  workspaceId: string
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO copilot_chat_project (chat_id, project_id)
    SELECT ${chatId}::uuid, pw.project_id FROM project_workspace pw
    WHERE pw.workspace_id = ${workspaceId}
    ON CONFLICT DO NOTHING
  `)
}

/** A forked chat carries its parent's projects. */
export async function copyChatProjects(
  tx: DbOrTx,
  fromChatId: string,
  toChatId: string
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO copilot_chat_project (chat_id, project_id)
    SELECT ${toChatId}::uuid, project_id FROM copilot_chat_project WHERE chat_id = ${fromChatId}::uuid
    ON CONFLICT DO NOTHING
  `)
}
