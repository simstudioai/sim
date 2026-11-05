import type { ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import styles from '@/platform/app/(shell)/chat/_components/message/message.module.css'
import { CopyButton, Disclosure, Icon } from '@/platform/design-system/components'

interface ToolActivityProps {
  label: string
  initiallyOpen: boolean
  steps: NonNullable<ChatTurn['response']>['steps']
  thinking?: string
  progress?: string
}

export function ToolActivity({
  label,
  initiallyOpen,
  steps,
  thinking,
  progress,
}: ToolActivityProps) {
  const introduction = (
    <>
      <hr className={styles.runRule} />
      {progress && <p data-type='T048'>{progress}</p>}
    </>
  )
  if (!thinking && !steps.length)
    return (
      <>
        <p className={styles.status} data-type='T048'>
          {label}
        </p>
        {introduction}
      </>
    )
  return (
    <Disclosure
      label={label}
      variant='activity'
      initiallyOpen={initiallyOpen}
      introduction={introduction}
    >
      <div className={styles.activityBody}>
        {thinking && <p data-type='T048'>{thinking}</p>}
        {steps.length > 0 && (
          <div className={styles.steps}>
            {steps.map((step) => (
              <details key={step.id} className={styles.step}>
                <summary>
                  <span className={styles.name} data-type='T048'>
                    {step.name}
                    <Icon name='I090' />
                  </span>
                  <time data-type='T052'>{step.time}</time>
                </summary>
                <dl className={styles.result}>
                  <div>
                    <dt data-type='T048'>
                      Input <CopyButton label='Copy tool input' text={step.input} />
                    </dt>
                    <dd>
                      <code data-type='T009'>{step.input}</code>
                    </dd>
                  </div>
                  <div>
                    <dt data-type='T048'>
                      Response <CopyButton label='Copy tool response' text={step.output} />
                    </dt>
                    <dd>
                      <code data-type='T009'>{step.output}</code>
                    </dd>
                  </div>
                </dl>
              </details>
            ))}
          </div>
        )}
      </div>
    </Disclosure>
  )
}
