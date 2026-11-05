import type { ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import styles from '@/platform/app/(shell)/chat/_components/message/message.module.css'
import { ResponseActions } from '@/platform/app/(shell)/chat/_components/message/response-actions'
import { ToolActivity } from '@/platform/app/(shell)/chat/_components/message/tool-activity'
import { Button } from '@/platform/design-system/components'

interface ResponseMessageProps {
  response: NonNullable<ChatTurn['response']>
  onRetry: () => void
}

export function ResponseMessage({ response, onRetry }: ResponseMessageProps) {
  const { state, duration, paragraphs } = response
  const status = {
    complete: `Worked for ${duration}`,
    running: duration ? `Working for ${duration}` : 'Working',
    failed: `Stopped after ${duration}`,
    stopped: 'Stopped',
  }[state]
  return (
    <div className={styles.answer}>
      <ToolActivity
        key={state}
        label={status}
        initiallyOpen={state === 'running' || state === 'failed'}
        steps={response.steps}
        thinking={response.thinking}
        progress={response.progress}
      />
      {paragraphs.map(({ lead, text }) => (
        <p key={text} data-type='T048'>
          {lead && (
            <>
              <strong>{lead}</strong>{' '}
            </>
          )}
          {text}
        </p>
      ))}
      {state === 'failed' && (
        <>
          {response.failure && <p data-type='T048'>{response.failure}</p>}
          <div className={styles.retry}>
            <Button variant='muted' size='compact' icon='I055' onClick={onRetry}>
              Retry
            </Button>
          </div>
        </>
      )}
      {paragraphs.length > 0 && (state === 'complete' || state === 'stopped') && (
        <ResponseActions
          text={paragraphs.map(({ lead, text }) => (lead ? `${lead} ${text}` : text)).join('\n\n')}
          time={response.time}
        />
      )}
    </div>
  )
}
