'use client'

import { useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { quickValidateEmail } from '@/lib/email/validation'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import Footer from '@/app/(landing)/components/footer/footer'
import Nav from '@/app/(landing)/components/nav/nav'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('CareersPage')

const validateName = (name: string): string[] => {
  const errors: string[] = []
  if (!name || name.trim().length < 2) {
    errors.push('Name must be at least 2 characters')
  }
  return errors
}

const validateEmail = (email: string): string[] => {
  const errors: string[] = []
  if (!email || !email.trim()) {
    errors.push('Email is required')
    return errors
  }
  const validation = quickValidateEmail(email.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || 'Please enter a valid email address')
  }
  return errors
}

const validatePosition = (position: string): string[] => {
  const errors: string[] = []
  if (!position || position.trim().length < 2) {
    errors.push('Please specify the position you are interested in')
  }
  return errors
}

const validateLinkedIn = (url: string): string[] => {
  if (!url || url.trim() === '') return []
  const errors: string[] = []
  try {
    new URL(url)
  } catch {
    errors.push('Please enter a valid LinkedIn URL')
  }
  return errors
}

const validatePortfolio = (url: string): string[] => {
  if (!url || url.trim() === '') return []
  const errors: string[] = []
  try {
    new URL(url)
  } catch {
    errors.push('Please enter a valid portfolio URL')
  }
  return errors
}

const validateLocation = (location: string): string[] => {
  const errors: string[] = []
  if (!location || location.trim().length < 2) {
    errors.push('Please enter your location')
  }
  return errors
}

const validateMessage = (message: string): string[] => {
  const errors: string[] = []
  if (!message || message.trim().length < 50) {
    errors.push('Please tell us more about yourself (at least 50 characters)')
  }
  return errors
}

export default function CareersPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [showErrors, setShowErrors] = useState(false)

  // Form fields
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [position, setPosition] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [portfolio, setPortfolio] = useState('')
  const [experience, setExperience] = useState('')
  const [location, setLocation] = useState('')
  const [message, setMessage] = useState('')
  const [resume, setResume] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Field errors
  const [nameErrors, setNameErrors] = useState<string[]>([])
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [positionErrors, setPositionErrors] = useState<string[]>([])
  const [linkedinErrors, setLinkedinErrors] = useState<string[]>([])
  const [portfolioErrors, setPortfolioErrors] = useState<string[]>([])
  const [experienceErrors, setExperienceErrors] = useState<string[]>([])
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [messageErrors, setMessageErrors] = useState<string[]>([])
  const [resumeErrors, setResumeErrors] = useState<string[]>([])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    setResume(file)
    if (file) {
      setResumeErrors([])
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setShowErrors(true)

    // Validate all fields
    const nameErrs = validateName(name)
    const emailErrs = validateEmail(email)
    const positionErrs = validatePosition(position)
    const linkedinErrs = validateLinkedIn(linkedin)
    const portfolioErrs = validatePortfolio(portfolio)
    const experienceErrs = experience ? [] : ['Please select your years of experience']
    const locationErrs = validateLocation(location)
    const messageErrs = validateMessage(message)
    const resumeErrs = resume ? [] : ['Resume is required']

    setNameErrors(nameErrs)
    setEmailErrors(emailErrs)
    setPositionErrors(positionErrs)
    setLinkedinErrors(linkedinErrs)
    setPortfolioErrors(portfolioErrs)
    setExperienceErrors(experienceErrs)
    setLocationErrors(locationErrs)
    setMessageErrors(messageErrs)
    setResumeErrors(resumeErrs)

    if (
      nameErrs.length > 0 ||
      emailErrs.length > 0 ||
      positionErrs.length > 0 ||
      linkedinErrs.length > 0 ||
      portfolioErrs.length > 0 ||
      experienceErrs.length > 0 ||
      locationErrs.length > 0 ||
      messageErrs.length > 0 ||
      resumeErrs.length > 0
    ) {
      return
    }

    setIsSubmitting(true)
    setSubmitStatus('idle')

    try {
      const formData = new FormData()
      formData.append('name', name)
      formData.append('email', email)
      formData.append('phone', phone || '')
      formData.append('position', position)
      formData.append('linkedin', linkedin || '')
      formData.append('portfolio', portfolio || '')
      formData.append('experience', experience)
      formData.append('location', location)
      formData.append('message', message)
      if (resume) formData.append('resume', resume)

      const response = await fetch('/api/careers/submit', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Failed to submit application')
      }

      setSubmitStatus('success')
    } catch (error) {
      logger.error('Error submitting application:', error)
      setSubmitStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className={`${soehne.className} min-h-screen bg-white text-gray-900`}>
      <Nav variant='landing' />

      {/* Content */}
      <div className='px-4 pt-[60px] pb-[80px] sm:px-8 md:px-[44px]'>
        <h1 className='mb-10 text-center font-bold text-4xl text-gray-900 md:text-5xl'>
          Join Our Team
        </h1>

        <div className='mx-auto max-w-4xl'>
          {/* Form Section */}
          <section className='rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10'>
            <form onSubmit={onSubmit} className='space-y-5'>
              {/* Name and Email */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='name' className='font-medium text-sm'>
                    Full Name *
                  </Label>
                  <Input
                    id='name'
                    placeholder='John Doe'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={cn(
                      showErrors &&
                        nameErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && nameErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {nameErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='email' className='font-medium text-sm'>
                    Email *
                  </Label>
                  <Input
                    id='email'
                    type='email'
                    placeholder='john@example.com'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={cn(
                      showErrors &&
                        emailErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && emailErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {emailErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Phone and Position */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='phone' className='font-medium text-sm'>
                    Phone Number
                  </Label>
                  <Input
                    id='phone'
                    type='tel'
                    placeholder='+1 (555) 123-4567'
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='position' className='font-medium text-sm'>
                    Position of Interest *
                  </Label>
                  <Input
                    id='position'
                    placeholder='e.g. Full Stack Engineer, Product Designer'
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className={cn(
                      showErrors &&
                        positionErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && positionErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {positionErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* LinkedIn and Portfolio */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='linkedin' className='font-medium text-sm'>
                    LinkedIn Profile
                  </Label>
                  <Input
                    id='linkedin'
                    placeholder='https://linkedin.com/in/yourprofile'
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    className={cn(
                      showErrors &&
                        linkedinErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && linkedinErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {linkedinErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='portfolio' className='font-medium text-sm'>
                    Portfolio / Website
                  </Label>
                  <Input
                    id='portfolio'
                    placeholder='https://yourportfolio.com'
                    value={portfolio}
                    onChange={(e) => setPortfolio(e.target.value)}
                    className={cn(
                      showErrors &&
                        portfolioErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && portfolioErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {portfolioErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Experience and Location */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='experience' className='font-medium text-sm'>
                    Years of Experience *
                  </Label>
                  <Select value={experience} onValueChange={setExperience}>
                    <SelectTrigger
                      className={cn(
                        showErrors &&
                          experienceErrors.length > 0 &&
                          'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                      )}
                    >
                      <SelectValue placeholder='Select experience level' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='0-1'>0-1 years</SelectItem>
                      <SelectItem value='1-3'>1-3 years</SelectItem>
                      <SelectItem value='3-5'>3-5 years</SelectItem>
                      <SelectItem value='5-10'>5-10 years</SelectItem>
                      <SelectItem value='10+'>10+ years</SelectItem>
                    </SelectContent>
                  </Select>
                  {showErrors && experienceErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {experienceErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='location' className='font-medium text-sm'>
                    Location *
                  </Label>
                  <Input
                    id='location'
                    placeholder='e.g. San Francisco, CA'
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className={cn(
                      showErrors &&
                        locationErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && locationErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {locationErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Message */}
              <div className='space-y-2'>
                <Label htmlFor='message' className='font-medium text-sm'>
                  Tell us about yourself *
                </Label>
                <Textarea
                  id='message'
                  placeholder='Tell us about your experience, what excites you about Sim, and why you would be a great fit for this role...'
                  className={cn(
                    'min-h-[140px]',
                    showErrors &&
                      messageErrors.length > 0 &&
                      'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                  )}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <p className='mt-1.5 text-gray-500 text-xs'>Minimum 50 characters</p>
                {showErrors && messageErrors.length > 0 && (
                  <div className='mt-1 space-y-1 text-red-400 text-xs'>
                    {messageErrors.map((error, index) => (
                      <p key={index}>{error}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Resume Upload */}
              <div className='space-y-2'>
                <Label htmlFor='resume' className='font-medium text-sm'>
                  Resume *
                </Label>
                <div className='relative'>
                  {resume ? (
                    <div className='flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2'>
                      <span className='flex-1 truncate text-sm'>{resume.name}</span>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.preventDefault()
                          setResume(null)
                          if (fileInputRef.current) {
                            fileInputRef.current.value = ''
                          }
                        }}
                        className='flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground'
                        aria-label='Remove file'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    </div>
                  ) : (
                    <Input
                      id='resume'
                      type='file'
                      accept='.pdf,.doc,.docx'
                      onChange={handleFileChange}
                      ref={fileInputRef}
                      className={cn(
                        showErrors &&
                          resumeErrors.length > 0 &&
                          'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                      )}
                    />
                  )}
                </div>
                <p className='mt-1.5 text-gray-500 text-xs'>PDF or Word document, max 10MB</p>
                {showErrors && resumeErrors.length > 0 && (
                  <div className='mt-1 space-y-1 text-red-400 text-xs'>
                    {resumeErrors.map((error, index) => (
                      <p key={index}>{error}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <div className='flex justify-end pt-2'>
                <Button
                  type='submit'
                  disabled={isSubmitting || submitStatus === 'success'}
                  className='min-w-[200px] rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] text-white shadow-[inset_0_2px_4px_0_#9B77FF] transition-all duration-300 hover:opacity-90 disabled:opacity-50'
                  size='lg'
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Submitting...
                    </>
                  ) : submitStatus === 'success' ? (
                    'Submitted'
                  ) : (
                    'Submit Application'
                  )}
                </Button>
              </div>
            </form>
          </section>

          {/* Additional Info */}
          <section className='mt-6 text-center text-gray-600 text-sm'>
            <p>
              Questions? Email us at{' '}
              <a
                href='mailto:careers@sim.ai'
                className='font-medium text-gray-900 underline transition-colors hover:text-gray-700'
              >
                careers@sim.ai
              </a>
            </p>
          </section>
        </div>
      </div>

      {/* Footer - Only for hosted instances */}
      {isHosted && (
        <div className='relative z-20'>
          <Footer fullWidth={true} />
        </div>
      )}
    </main>
  )
}
