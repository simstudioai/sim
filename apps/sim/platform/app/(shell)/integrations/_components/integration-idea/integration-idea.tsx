import styles from '@/platform/app/(shell)/integrations/_components/integration-idea/integration-idea.module.css'
import { Icon } from '@/platform/design-system/components'
import { publicAssetPath } from '@/platform/design-system/navigation'

interface IntegrationIdeaProps {
  providerId: string
  name: string
  example: string
}

export function IntegrationIdea({ providerId, name, example }: IntegrationIdeaProps) {
  return (
    <section className={styles.idea} aria-label={`Idea for ${name}`}>
      <img
        className={styles.artwork}
        src={publicAssetPath('/integration-artwork/fireflies-world.webp')}
        alt=''
        width={2172}
        height={724}
      />
      <div className={styles.message}>
        <span className={styles.mark}>
          <Icon providerId={providerId} />
        </span>
        <p data-type='T048'>{example}</p>
      </div>
    </section>
  )
}
