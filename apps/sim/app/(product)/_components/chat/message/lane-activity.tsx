import { Disclosure } from '@sim/emcn/disclosure'
import { InlineNotice } from '@sim/emcn/status'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import { MessageSegments } from '@/app/(product)/_components/chat/message/message-segments'
import {
  ToolActivity,
  ToolInteraction,
} from '@/app/(product)/_components/chat/message/tool-activity'
import type { PlatformLane } from '@/platform/lib/data/models/chat'

/** One subagent's work under its own disclosure. A held approval renders outside the collapse. */
export function LaneActivity({ lane }: { lane: PlatformLane }) {
  const held = lane.items.flatMap((item) =>
    item.kind === 'tool' && (item.tool.status === 'awaiting_approval' || item.tool.handoff)
      ? [item.tool]
      : []
  )
  const heldIds = new Set(held.map((tool) => tool.id))
  return (
    <div className={styles.lane}>
      <Disclosure
        label={lane.status ? `${lane.label} · ${lane.status}` : lane.label}
        variant='activity'
        initiallyOpen={lane.running}
      >
        <div className={styles.activityBody}>
          {lane.items.map((item) => {
            if (item.kind === 'text')
              return <MessageSegments key={item.id} segments={item.segments} />
            if (item.kind === 'lane') return <LaneActivity key={item.lane.id} lane={item.lane} />
            if (heldIds.has(item.tool.id)) return null
            return (
              <ToolActivity
                key={item.tool.id}
                label={item.tool.title}
                initiallyOpen={false}
                steps={[item.tool]}
              />
            )
          })}
        </div>
      </Disclosure>
      {lane.error && <InlineNotice intent='danger' message={lane.error} />}
      {held.map((tool) => (
        <ToolInteraction key={tool.id} tool={tool} />
      ))}
    </div>
  )
}
