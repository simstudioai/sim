'use client'

/** Minimal presence shape the avatar stack renders — shared by workflow and files. */
export interface PresenceAvatarUser {
  /** Unique id per presence entry, used as the render key: a socket id where presence is
   *  per-connection (workflow), absent where entries are deduped per user (file docs). */
  socketId?: string
  userId: string
  userName?: string
  avatarUrl?: string | null
}
