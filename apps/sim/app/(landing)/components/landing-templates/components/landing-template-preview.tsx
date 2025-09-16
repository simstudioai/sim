import { inter } from '@/app/fonts/inter'

interface LandingTemplatePreviewProps {
  previewImage: string
  avatarImage: string
  title: string
  authorName: string
  usageCount: number
}

export default function LandingTemplatePreview({
  previewImage,
  avatarImage,
  title,
  authorName,
  usageCount,
}: LandingTemplatePreviewProps) {
  return (
    <div className='flex flex-col'>
      {/* Preview Image */}
      <div
        className='h-44 w-full rounded-[10px] bg-center bg-cover bg-no-repeat'
        style={{
          backgroundImage: `url(${previewImage}), linear-gradient(to right, #F5F5F5, #F5F5F5)`,
        }}
      />

      {/* Author and Info Section */}
      <div className='mt-4 flex items-center gap-3'>
        {/* Avatar */}
        <div
          className='h-[32px] w-[32px] flex-shrink-0 rounded-full bg-center bg-cover bg-no-repeat'
          style={{
            backgroundImage: `url(${avatarImage}), linear-gradient(to right, #F5F5F5, #F5F5F5)`,
          }}
        />

        {/* Title and Author Info */}
        <div className='min-w-0 flex-1'>
          <h4
            className={`${inter.className} truncate font-medium text-foreground text-sm leading-none`}
          >
            {title}
          </h4>
          <p
            className={`${inter.className} mt-1 flex items-center gap-2 text-muted-foreground text-xs`}
          >
            <span>{authorName}</span>
            <span>{usageCount.toLocaleString()} copies</span>
          </p>
        </div>
      </div>
    </div>
  )
}
