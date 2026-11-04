import styles from '@/platform/design-system/components/collections.module.css'

interface ExecutionStepsProps {
  title: string
  steps: readonly { id: string; description: string }[]
}

export function ExecutionSteps({ title, steps }: ExecutionStepsProps) {
  return (
    <section className={styles.steps}>
      <h3 className={styles.stepsTitle} data-type='T042'>
        {title}
      </h3>
      <ol className={styles.stepList} aria-label={title}>
        {steps.map((step, index) => (
          <li className={styles.step} key={step.id}>
            <span className={styles.marker} data-type='T050' aria-hidden='true'>
              {index + 1}
            </span>
            <span className={styles.description} data-type='T043'>
              {step.description}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
