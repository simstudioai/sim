import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

const CATEGORIES = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'research', label: 'Research' },
  { id: 'utilities', label: 'Utilities' },
]

function Templates() {
  const [selectedCategory, setSelectedCategory] = React.useState('recommended')

  return (
    <div className='border-t border-border flex justify-center items-center px-4 sm:px-8 md:px-12 lg:px-40'>
      <div className='w-full h-full flex flex-col p-6 sm:p-8 md:p-12 gap-10 border-l border-r border-border'>
        <p className='text-3xl font-medium leading-none text-foreground'>
            From the community
        </p>
        <div className='flex flex-col gap-8'>
            <div className='flex flex-col sm:flex-row justify-between sm:items-center gap-4 sm:gap-0'>
                {/* Category Selector */}
                <div className='flex items-center gap-1'>
                  {CATEGORIES.map((category) => (
                    <Button
                      key={category.id}
                      variant={selectedCategory === category.id ? 'secondary' : 'ghost'}
                      onClick={() => setSelectedCategory(category.id)}
                      className={`h-10 px-4 rounded-[14px] text-sm ${
                        selectedCategory === category.id ? '' : 'text-muted-foreground'
                      }`}
                    >
                      {category.label}
                    </Button>
                  ))}
                </div>
                {/* Search Bar */}
                <div className='relative'>
                  <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    placeholder='Search templates...'
                    className='h-10 w-full sm:w-80 pl-10 shadow-sm pr-4 bg-background border-border rounded-[14px]'
                  />
                </div>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
                {/* Template Cards */}
            </div>
        </div>
      </div>
    </div>
  )
}

export default Templates
