import type { listSlackSearchInstallations } from '@/lib/knowledge/application/slack-search/installations'

type SlackSearchInstallations = Awaited<ReturnType<typeof listSlackSearchInstallations.execute>>

export function presentSlackSearchList({
  installations,
  bots,
  sharedAppAvailable,
  memberAppKind,
}: SlackSearchInstallations) {
  return {
    sharedAppAvailable,
    memberAppKind,
    bots,
    installations: installations.map((row) => ({
      ...row,
      lastEventAt: row.lastEventAt?.toISOString() ?? null,
    })),
  }
}
