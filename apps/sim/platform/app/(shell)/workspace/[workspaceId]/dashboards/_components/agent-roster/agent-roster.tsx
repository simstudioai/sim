import { ActivityRow } from '@sim/emcn/activity-row'
import type { AgentRosterItem } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/agent-roster/agent-roster.module.css'

interface AgentRosterProps {
  label: string
  agents: readonly AgentRosterItem[]
}

/** A compact read-only roster: each agent, its live status and a trailing figure. */
export function AgentRoster({ label, agents }: AgentRosterProps) {
  return (
    <ul className={styles.roster} aria-label={label}>
      {agents.map((agent) => (
        <ActivityRow
          key={agent.id}
          readOnly
          title={agent.name}
          detail={agent.detail ? `${agent.status.label} ${agent.detail}` : agent.status.label}
          detailContent={
            <>
              <span className={styles.status} data-tone={agent.status.tone}>
                {agent.status.label}
              </span>
              {agent.detail && ` ${agent.detail}`}
            </>
          }
          textMetadata={agent.metadata}
        />
      ))}
    </ul>
  )
}
