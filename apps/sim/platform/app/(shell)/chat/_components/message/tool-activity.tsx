'use client'

import { useState } from 'react'
import type { ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import { CopyAction } from '@/platform/app/(shell)/chat/_components/message/copy-action'
import styles from '@/platform/app/(shell)/chat/_components/message/message.module.css'
import { Disclosure, Icon } from '@/platform/design-system/components'

interface ToolActivityProps {
  label: string
  initiallyOpen: boolean
  steps: NonNullable<ChatTurn['response']>['steps']
  thinking?: string
}

export function ToolActivity({ label, initiallyOpen, steps, thinking }: ToolActivityProps) {
  const [open, setOpen] = useState(initiallyOpen)
  if (!thinking && !steps.length)
    return (
      <div className={styles.activity}>
        <p data-type='T060'>{label}</p>
        <hr />
      </div>
    )
  return (
    <div className={styles.activity}>
      <Disclosure label={label} variant='activity' open={open} onOpenChange={setOpen}>
        <div className={styles.activityBody}>
          <hr />
          {thinking && <p data-type='T060'>{thinking}</p>}
          {steps.map((step) => (
            <details key={step.id} className={styles.step}>
              <summary>
                <span className={styles.name} data-type='T060'>
                  {step.name}
                  {step.detail && <span className={styles.qualifier}>{step.detail}</span>}
                  <Icon name='I090' />
                </span>
                <time data-type='T052'>{step.time}</time>
              </summary>
              <dl className={styles.result}>
                <div>
                  <dt data-type='T051'>Input</dt>
                  <dd>
                    <code data-type='T009'>{step.input}</code>
                  </dd>
                </div>
                <div>
                  <dt data-type='T051'>
                    Response <CopyAction label='Copy tool response' text={step.output} />
                  </dt>
                  <dd>
                    <code data-type='T009'>{step.output}</code>
                  </dd>
                </div>
              </dl>
            </details>
          ))}
        </div>
      </Disclosure>
      {!open && <hr />}
    </div>
  )
}
