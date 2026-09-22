/** Serializes domain timestamps without changing the surface's resource projection. */
export function presentPermissionGroup<T extends { createdAt: Date; updatedAt: Date }>(group: T) {
  return {
    ...group,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  }
}

export function presentPermissionGroupMember<T extends { assignedAt: Date }>(member: T) {
  return { ...member, assignedAt: member.assignedAt.toISOString() }
}
