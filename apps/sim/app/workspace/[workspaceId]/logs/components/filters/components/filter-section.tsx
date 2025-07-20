export default function FilterSection({
  title,
  content,
}: {
  title: string
  content?: React.ReactNode
}) {
  return (
    <div className='space-y-1'>
      <div className='font-medium text-muted-foreground text-xs'>{title}</div>
      <div>
        {content || (
          <div className='text-muted-foreground text-sm'>
            Filter options for {title} will go here
          </div>
        )}
      </div>
    </div>
  )
}
