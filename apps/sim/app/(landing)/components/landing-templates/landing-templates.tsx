import { inter } from '@/app/fonts/inter'
import LandingTemplatePreview from './components/landing-template-preview'

// Mock data for templates
const templates = [
  {
    id: 1,
    previewImage: '/placeholder-template-1.jpg',
    avatarImage: '/placeholder-avatar-1.jpg',
    title: 'Meeting notetaker',
    authorName: 'Emir Ayaz',
    usageCount: 7800,
  },
  {
    id: 2,
    previewImage: '/placeholder-template-2.jpg',
    avatarImage: '/placeholder-avatar-2.jpg',
    title: 'Cold outreach sender',
    authorName: 'Liam Chen',
    usageCount: 15000,
  },
  {
    id: 3,
    previewImage: '/placeholder-template-3.jpg',
    avatarImage: '/placeholder-avatar-3.jpg',
    title: 'Campaign scheduler',
    authorName: 'Jade Monroe',
    usageCount: 11800,
  },
  {
    id: 4,
    previewImage: '/placeholder-template-4.jpg',
    avatarImage: '/placeholder-avatar-4.jpg',
    title: 'Lead qualifier',
    authorName: 'Marcus Vega',
    usageCount: 13200,
  },
  {
    id: 5,
    previewImage: '/placeholder-template-5.jpg',
    avatarImage: '/placeholder-avatar-5.jpg',
    title: 'Performance reporter',
    authorName: 'Emily Zhao',
    usageCount: 9500,
  },
  {
    id: 6,
    previewImage: '/placeholder-template-6.jpg',
    avatarImage: '/placeholder-avatar-6.jpg',
    title: 'Ad copy generator',
    authorName: 'Carlos Mendez',
    usageCount: 14200,
  },
  {
    id: 7,
    previewImage: '/placeholder-template-7.jpg',
    avatarImage: '/placeholder-avatar-7.jpg',
    title: 'Product launch email',
    authorName: 'Lucas Patel',
    usageCount: 10500,
  },
  {
    id: 8,
    previewImage: '/placeholder-template-8.jpg',
    avatarImage: '/placeholder-avatar-8.jpg',
    title: 'Customer support chatbot',
    authorName: 'Sophia Nguyen',
    usageCount: 12000,
  },
  {
    id: 9,
    previewImage: '/placeholder-template-9.jpg',
    avatarImage: '/placeholder-avatar-9.jpg',
    title: 'Event planner',
    authorName: 'Aiden Kim',
    usageCount: 13500,
  },
]

export default function LandingTemplates() {
  return (
    <section
      id='templates'
      className={`${inter.className} flex flex-col px-4 pt-[40px] sm:px-[50px] sm:pt-[34px]`}
      aria-labelledby='templates-heading'
    >
      <h2
        id='templates-heading'
        className='mb-[16px] font-medium text-[28px] text-foreground tracking-tight sm:mb-[24px]'
      >
        Templates
      </h2>

      {/* Templates Grid */}
      <div className='grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-3'>
        {templates.map((template, index) => (
          <div
            key={template.id}
            className={`
              ${index >= 3 ? 'hidden md:block' : ''} ${index >= 6 ? 'md:hidden lg:block' : ''} `}
          >
            <LandingTemplatePreview
              previewImage={template.previewImage}
              avatarImage={template.avatarImage}
              title={template.title}
              authorName={template.authorName}
              usageCount={template.usageCount}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
