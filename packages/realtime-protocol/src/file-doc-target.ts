import {
  projectFileDocRoom,
  projectFileDocTarget,
  ROOM_TYPES,
  type RoomRef,
} from '@sim/realtime-protocol/rooms'

/** An asserted owner; the relay still resolves current access through the owning application. */
export interface FileDocOwner {
  entityType: 'workspace' | 'project'
  entityId: string
}

/** A document target with explicit ownership; asserted ownership still requires authorization. */
export interface FileDocTarget {
  fileId: string
  owner: FileDocOwner
}

/** Incoming workspace messages may omit the owner until canonical authorization resolves it. */
interface FileDocWireTarget {
  fileId: string
  owner?: FileDocOwner
}

interface OwnerCodec {
  room(entityId: string, fileId: string): RoomRef
  admission(entityId: string, fileId: string): string
}

const OWNER_CODECS: Record<FileDocOwner['entityType'], OwnerCodec> = {
  workspace: {
    room: (_entityId, fileId) => ({ type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: fileId }),
    admission: (_entityId, fileId) => `file-doc-admission:${fileId}`,
  },
  project: {
    room: projectFileDocRoom,
    admission: (entityId, fileId) => `file-doc-admission:${entityId}/${fileId}`,
  },
}

/** Normalize old wire hints once; unknown owners and conflicting assertions never fall back. */
export function parseFileDocTarget(input: {
  fileId?: unknown
  owner?: unknown
  projectId?: unknown
}): FileDocWireTarget | null {
  if (typeof input.fileId !== 'string' || !input.fileId) return null
  const { fileId } = input
  const candidate =
    input.owner ??
    (input.projectId === undefined
      ? undefined
      : { entityType: 'project', entityId: input.projectId })
  if (input.owner === null) return null
  if (candidate === undefined) return { fileId }
  if (typeof candidate !== 'object' || candidate === null) return null
  const owner = candidate as Partial<FileDocOwner>
  if (
    typeof owner.entityType !== 'string' ||
    !Object.hasOwn(OWNER_CODECS, owner.entityType) ||
    typeof owner.entityId !== 'string' ||
    !owner.entityId ||
    owner.entityId.length > 200 ||
    owner.entityId !== owner.entityId.trim() ||
    /[/:]/.test(owner.entityId) ||
    /[/:]/.test(fileId) ||
    (input.projectId !== undefined &&
      (owner.entityType !== 'project' || owner.entityId !== input.projectId))
  )
    return null
  return { fileId, owner: { entityType: owner.entityType, entityId: owner.entityId } }
}

/** Encode owner-qualified targets without renaming deployed Socket.IO or Redis addresses. */
export function fileDocRoom(target: FileDocWireTarget): RoomRef {
  return target.owner
    ? OWNER_CODECS[target.owner.entityType].room(target.owner.entityId, target.fileId)
    : { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: target.fileId }
}

/** Pending admissions use the same compatibility codec as their live document. */
export function fileDocAdmissionRoom(target: FileDocWireTarget): string {
  return target.owner
    ? OWNER_CODECS[target.owner.entityType].admission(target.owner.entityId, target.fileId)
    : `file-doc-admission:${target.fileId}`
}

/** Workspace ownership is resolved after authorization because legacy room names omit it. */
export function fileDocTargetFromRoom(room: RoomRef): FileDocWireTarget | null {
  if (room.type === ROOM_TYPES.WORKSPACE_FILE_DOC) return { fileId: room.id }
  const project = projectFileDocTarget(room)
  return project
    ? { fileId: project.fileId, owner: { entityType: 'project', entityId: project.projectId } }
    : null
}

/** Include explicit ownership while retaining the Project hint understood by older relays. */
export function fileDocOwnerWireFields(owner: FileDocOwner) {
  return { owner, ...(owner.entityType === 'project' ? { projectId: owner.entityId } : {}) }
}
