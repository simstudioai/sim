import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/text-block/text-block.module.css'

interface TextBlockProps {
  blockId: string
  subBlockId: string
  /** Plain text, or the trusted HTML a block definition ships for links and emphasis. */
  content: string
}

/** Read-only guidance a block shows among its fields. */
export function TextBlock({ blockId, subBlockId, content }: TextBlockProps) {
  const id = `${blockId}-${subBlockId}`
  if (/<[^>]+>/.test(content))
    return (
      <div
        id={id}
        className={`${styles.text} ${styles.rich}`}
        data-type='T060'
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  return (
    <div id={id} className={styles.text} data-type='T060'>
      {content}
    </div>
  )
}
