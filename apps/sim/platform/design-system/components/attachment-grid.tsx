import { ComponentRecipe } from '@/platform/design-system/catalog/component-recipe'
import styles from '@/platform/design-system/components/collections.module.css'
import { ScrollArea } from '@/platform/design-system/components/scroll-area'

export type AttachmentItem = {
  id: string
  name: string
  description: string
} & ({ kind: 'image'; preview?: string } | { kind: 'paste' | 'pdf' })

const attachmentRecipes = {
  pdf: { light: 'C0201', dark: 'C0200' },
  paste: { light: 'C0195', dark: 'C0194' },
} as const

interface AttachmentGridProps {
  label: string
  attachments: readonly AttachmentItem[]
  layout?: 'grid' | 'list'
  theme: 'light' | 'dark'
}

export function AttachmentGrid({
  label,
  attachments,
  theme,
  layout = 'grid',
}: AttachmentGridProps) {
  const content = (
    <ul className={styles.attachmentItems} aria-label={label} data-layout={layout}>
      {attachments.map((item) => {
        const slots = { label: item.name, caption: item.description }
        return (
          <li key={item.id} className={styles.attachmentItem}>
            {item.kind === 'image' ? (
              <ComponentRecipe
                recipe={theme === 'light' ? 'C0193' : 'C0192'}
                slots={{
                  ...slots,
                  media: item.preview ? (
                    <img className={styles.thumbnail} alt='' src={item.preview} />
                  ) : null,
                }}
              />
            ) : (
              <ComponentRecipe recipe={attachmentRecipes[item.kind][theme]} slots={slots} />
            )}
          </li>
        )
      })}
    </ul>
  )
  return layout === 'list' ? (
    <div className={styles.attachmentViewport}>
      <ScrollArea label={label}>{content}</ScrollArea>
    </div>
  ) : (
    content
  )
}
