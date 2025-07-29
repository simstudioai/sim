import { useEffect, useState } from 'react'
import { Search, Trash2, X } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { TimeInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components'
import { UnsavedChangesDialog } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('ScheduleModal')

interface ScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  workflowId: string
  blockId: string
  onSave: () => Promise<boolean>
  onDelete?: () => Promise<boolean>
  scheduleId?: string | null
}

// Timezone data with searchable keywords
const timezoneOptions = [
  { value: 'UTC', label: 'UTC', keywords: 'UTC GMT' },

  // UTC-10 to UTC-3 (Western Hemisphere)
  {
    value: 'Pacific/Honolulu',
    label: 'US Hawaii (UTC-10)',
    keywords: 'Hawaii Honolulu Pacific US America',
  },
  {
    value: 'America/Anchorage',
    label: 'US Alaska (UTC-8)',
    keywords: 'Alaska Anchorage US America',
  },
  {
    value: 'America/Los_Angeles',
    label: 'US Pacific (UTC-7/-8)',
    keywords: 'Los Angeles California Pacific US America PST PDT',
  },
  {
    value: 'America/Vancouver',
    label: 'Canada Pacific (UTC-7/-8)',
    keywords: 'Vancouver Canada Pacific PST PDT',
  },
  {
    value: 'America/Denver',
    label: 'US Mountain (UTC-6/-7)',
    keywords: 'Denver Colorado Mountain US America MST MDT',
  },
  {
    value: 'America/Chicago',
    label: 'US Central (UTC-5/-6)',
    keywords: 'Chicago Illinois Central US America CST CDT',
  },
  {
    value: 'America/Mexico_City',
    label: 'Mexico City (UTC-5/-6)',
    keywords: 'Mexico City Mexico CST CDT',
  },
  { value: 'America/Bogota', label: 'Bogota (UTC-5)', keywords: 'Bogota Colombia South America' },
  { value: 'America/Lima', label: 'Lima (UTC-5)', keywords: 'Lima Peru South America' },
  {
    value: 'America/New_York',
    label: 'US Eastern (UTC-4/-5)',
    keywords: 'New York Eastern US America EST EDT',
  },
  {
    value: 'America/Toronto',
    label: 'Canada Eastern (UTC-4/-5)',
    keywords: 'Toronto Canada Eastern EST EDT',
  },
  {
    value: 'America/Sao_Paulo',
    label: 'São Paulo (UTC-2/-3)',
    keywords: 'Sao Paulo Brazil South America',
  },
  {
    value: 'America/Argentina/Buenos_Aires',
    label: 'Buenos Aires (UTC-3)',
    keywords: 'Buenos Aires Argentina South America',
  },
  {
    value: 'America/Santiago',
    label: 'Santiago (UTC-3/-4)',
    keywords: 'Santiago Chile South America',
  },

  // UTC+1 to UTC+3 (Europe & Africa)
  {
    value: 'Europe/London',
    label: 'London (UTC+0/+1)',
    keywords: 'London England UK Britain Europe GMT BST',
  },
  { value: 'Africa/Lagos', label: 'Lagos (UTC+1)', keywords: 'Lagos Nigeria Africa' },
  {
    value: 'Africa/Casablanca',
    label: 'Casablanca (UTC+0/+1)',
    keywords: 'Casablanca Morocco Africa',
  },
  { value: 'Europe/Paris', label: 'Paris (UTC+1/+2)', keywords: 'Paris France Europe CET CEST' },
  {
    value: 'Europe/Berlin',
    label: 'Berlin (UTC+1/+2)',
    keywords: 'Berlin Germany Europe CET CEST',
  },
  { value: 'Europe/Rome', label: 'Rome (UTC+1/+2)', keywords: 'Rome Italy Europe CET CEST' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+1/+2)', keywords: 'Madrid Spain Europe CET CEST' },
  {
    value: 'Europe/Amsterdam',
    label: 'Amsterdam (UTC+1/+2)',
    keywords: 'Amsterdam Netherlands Europe CET CEST',
  },
  {
    value: 'Europe/Brussels',
    label: 'Brussels (UTC+1/+2)',
    keywords: 'Brussels Belgium Europe CET CEST',
  },
  {
    value: 'Europe/Vienna',
    label: 'Vienna (UTC+1/+2)',
    keywords: 'Vienna Austria Europe CET CEST',
  },
  {
    value: 'Europe/Zurich',
    label: 'Zurich (UTC+1/+2)',
    keywords: 'Zurich Switzerland Europe CET CEST',
  },
  {
    value: 'Europe/Stockholm',
    label: 'Stockholm (UTC+1/+2)',
    keywords: 'Stockholm Sweden Europe CET CEST',
  },
  { value: 'Europe/Oslo', label: 'Oslo (UTC+1/+2)', keywords: 'Oslo Norway Europe CET CEST' },
  {
    value: 'Europe/Copenhagen',
    label: 'Copenhagen (UTC+1/+2)',
    keywords: 'Copenhagen Denmark Europe CET CEST',
  },
  {
    value: 'Europe/Prague',
    label: 'Prague (UTC+1/+2)',
    keywords: 'Prague Czech Republic Europe CET CEST',
  },
  { value: 'Europe/Warsaw', label: 'Warsaw (UTC+1/+2)', keywords: 'Warsaw Poland Europe CET CEST' },
  {
    value: 'Europe/Budapest',
    label: 'Budapest (UTC+1/+2)',
    keywords: 'Budapest Hungary Europe CET CEST',
  },
  {
    value: 'Africa/Johannesburg',
    label: 'Johannesburg (UTC+2)',
    keywords: 'Johannesburg South Africa Africa',
  },
  {
    value: 'Europe/Helsinki',
    label: 'Helsinki (UTC+2/+3)',
    keywords: 'Helsinki Finland Europe EET EEST',
  },
  { value: 'Europe/Athens', label: 'Athens (UTC+2/+3)', keywords: 'Athens Greece Europe EET EEST' },
  {
    value: 'Europe/Bucharest',
    label: 'Bucharest (UTC+2/+3)',
    keywords: 'Bucharest Romania Europe EET EEST',
  },
  { value: 'Europe/Sofia', label: 'Sofia (UTC+2/+3)', keywords: 'Sofia Bulgaria Europe EET EEST' },
  { value: 'Europe/Kiev', label: 'Kiev (UTC+2/+3)', keywords: 'Kiev Ukraine Europe EET EEST' },
  { value: 'Europe/Moscow', label: 'Moscow (UTC+3)', keywords: 'Moscow Russia Europe MSK' },
  { value: 'Europe/Istanbul', label: 'Istanbul (UTC+3)', keywords: 'Istanbul Turkey Europe' },
  { value: 'Africa/Cairo', label: 'Cairo (UTC+2/+3)', keywords: 'Cairo Egypt Africa EET EEST' },
  { value: 'Africa/Nairobi', label: 'Nairobi (UTC+3)', keywords: 'Nairobi Kenya Africa' },
  {
    value: 'Africa/Addis_Ababa',
    label: 'Addis Ababa (UTC+3)',
    keywords: 'Addis Ababa Ethiopia Africa',
  },
  { value: 'Asia/Tehran', label: 'Tehran (UTC+3:30/+4:30)', keywords: 'Tehran Iran Asia' },

  // UTC+4 to UTC+6 (Central Asia)
  { value: 'Asia/Dubai', label: 'Dubai (UTC+4)', keywords: 'Dubai UAE United Arab Emirates Asia' },
  { value: 'Asia/Kabul', label: 'Kabul (UTC+4:30)', keywords: 'Kabul Afghanistan Asia' },
  { value: 'Asia/Tashkent', label: 'Tashkent (UTC+5)', keywords: 'Tashkent Uzbekistan Asia' },
  { value: 'Asia/Kolkata', label: 'Kolkata (UTC+5:30)', keywords: 'Kolkata India Asia IST' },
  { value: 'Asia/Kathmandu', label: 'Kathmandu (UTC+5:45)', keywords: 'Kathmandu Nepal Asia' },
  { value: 'Asia/Almaty', label: 'Almaty (UTC+6)', keywords: 'Almaty Kazakhstan Asia' },
  { value: 'Asia/Dhaka', label: 'Dhaka (UTC+6)', keywords: 'Dhaka Bangladesh Asia' },
  { value: 'Asia/Yangon', label: 'Yangon (UTC+6:30)', keywords: 'Yangon Myanmar Burma Asia' },

  // UTC+7 to UTC+9 (Southeast & East Asia)
  {
    value: 'Asia/Novosibirsk',
    label: 'Novosibirsk (UTC+6/+7)',
    keywords: 'Novosibirsk Russia Asia',
  },
  {
    value: 'Asia/Krasnoyarsk',
    label: 'Krasnoyarsk (UTC+7/+8)',
    keywords: 'Krasnoyarsk Russia Asia',
  },
  { value: 'Asia/Bangkok', label: 'Bangkok (UTC+7)', keywords: 'Bangkok Thailand Asia' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh (UTC+7)', keywords: 'Ho Chi Minh Vietnam Asia' },
  { value: 'Asia/Jakarta', label: 'Jakarta (UTC+7)', keywords: 'Jakarta Indonesia Asia' },
  { value: 'Asia/Irkutsk', label: 'Irkutsk (UTC+8/+9)', keywords: 'Irkutsk Russia Asia' },
  { value: 'Asia/Manila', label: 'Manila (UTC+8)', keywords: 'Manila Philippines Asia' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+8)', keywords: 'Singapore Asia' },
  {
    value: 'Asia/Kuala_Lumpur',
    label: 'Kuala Lumpur (UTC+8)',
    keywords: 'Kuala Lumpur Malaysia Asia',
  },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (UTC+8)', keywords: 'Hong Kong China Asia' },
  { value: 'Asia/Shanghai', label: 'Shanghai (UTC+8)', keywords: 'Shanghai China Asia' },
  {
    value: 'Asia/Ulaanbaatar',
    label: 'Ulaanbaatar (UTC+8)',
    keywords: 'Ulaanbaatar Mongolia Asia',
  },
  { value: 'Australia/Perth', label: 'Perth (UTC+8)', keywords: 'Perth Australia Oceania' },
  { value: 'Asia/Yakutsk', label: 'Yakutsk (UTC+9/+10)', keywords: 'Yakutsk Russia Asia' },
  { value: 'Asia/Seoul', label: 'Seoul (UTC+9)', keywords: 'Seoul South Korea Asia' },
  { value: 'Asia/Tokyo', label: 'Tokyo (UTC+9)', keywords: 'Tokyo Japan Asia JST' },
  { value: 'Asia/Pyongyang', label: 'Pyongyang (UTC+9)', keywords: 'Pyongyang North Korea Asia' },

  // UTC+10 to UTC+14 (Oceania & Pacific)
  {
    value: 'Australia/Adelaide',
    label: 'Adelaide (UTC+9:30/+10:30)',
    keywords: 'Adelaide Australia Oceania',
  },
  { value: 'Australia/Darwin', label: 'Darwin (UTC+9:30)', keywords: 'Darwin Australia Oceania' },
  {
    value: 'Australia/Brisbane',
    label: 'Brisbane (UTC+10)',
    keywords: 'Brisbane Australia Oceania',
  },
  {
    value: 'Australia/Sydney',
    label: 'Sydney (UTC+10/+11)',
    keywords: 'Sydney Australia Oceania AEST AEDT',
  },
  {
    value: 'Australia/Melbourne',
    label: 'Melbourne (UTC+10/+11)',
    keywords: 'Melbourne Australia Oceania AEST AEDT',
  },
  {
    value: 'Australia/Hobart',
    label: 'Hobart (UTC+10/+11)',
    keywords: 'Hobart Australia Oceania AEST AEDT',
  },
  { value: 'Pacific/Guam', label: 'Guam (UTC+10)', keywords: 'Guam Pacific' },
  {
    value: 'Pacific/Port_Moresby',
    label: 'Port Moresby (UTC+10)',
    keywords: 'Port Moresby Papua New Guinea Pacific',
  },
  {
    value: 'Australia/Lord_Howe',
    label: 'Lord Howe (UTC+10:30/+11)',
    keywords: 'Lord Howe Australia Oceania',
  },
  {
    value: 'Asia/Vladivostok',
    label: 'Vladivostok (UTC+10/+11)',
    keywords: 'Vladivostok Russia Asia',
  },
  { value: 'Asia/Magadan', label: 'Magadan (UTC+11/+12)', keywords: 'Magadan Russia Asia' },
  { value: 'Pacific/Noumea', label: 'Noumea (UTC+11)', keywords: 'Noumea New Caledonia Pacific' },
  { value: 'Pacific/Norfolk', label: 'Norfolk (UTC+11)', keywords: 'Norfolk Island Pacific' },
  { value: 'Asia/Kamchatka', label: 'Kamchatka (UTC+12)', keywords: 'Kamchatka Russia Asia' },
  {
    value: 'Pacific/Auckland',
    label: 'Auckland (UTC+12/+13)',
    keywords: 'Auckland New Zealand Oceania NZST NZDT',
  },
  { value: 'Pacific/Fiji', label: 'Fiji (UTC+12)', keywords: 'Fiji Pacific' },
  { value: 'Pacific/Tarawa', label: 'Tarawa (UTC+12)', keywords: 'Tarawa Kiribati Pacific' },
  {
    value: 'Pacific/Kwajalein',
    label: 'Kwajalein (UTC+12)',
    keywords: 'Kwajalein Marshall Islands Pacific',
  },
  { value: 'Pacific/Apia', label: 'Apia (UTC+13/+14)', keywords: 'Apia Samoa Pacific' },
  {
    value: 'Pacific/Kiritimati',
    label: 'Kiritimati (UTC+14)',
    keywords: 'Kiritimati Christmas Island Pacific',
  },
]

export function ScheduleModal({
  isOpen,
  onClose,
  workflowId,
  blockId,
  onSave,
  onDelete,
  scheduleId,
}: ScheduleModalProps) {
  // States for schedule configuration
  const [scheduleType, setScheduleType] = useSubBlockValue(blockId, 'scheduleType')
  const [minutesInterval, setMinutesInterval] = useSubBlockValue(blockId, 'minutesInterval')
  const [hourlyMinute, setHourlyMinute] = useSubBlockValue(blockId, 'hourlyMinute')
  const [dailyTime, setDailyTime] = useSubBlockValue(blockId, 'dailyTime')
  const [weeklyDay, setWeeklyDay] = useSubBlockValue(blockId, 'weeklyDay')
  const [weeklyDayTime, setWeeklyDayTime] = useSubBlockValue(blockId, 'weeklyDayTime')
  const [monthlyDay, setMonthlyDay] = useSubBlockValue(blockId, 'monthlyDay')
  const [monthlyTime, setMonthlyTime] = useSubBlockValue(blockId, 'monthlyTime')
  const [cronExpression, setCronExpression] = useSubBlockValue(blockId, 'cronExpression')
  const [timezone, setTimezone] = useSubBlockValue(blockId, 'timezone')

  // Get the startWorkflow value at the component level
  const [startWorkflow, setStartWorkflow] = useSubBlockValue(blockId, 'startWorkflow')

  // UI states
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [timezoneOpen, setTimezoneOpen] = useState(false)
  const [timezoneSearchQuery, setTimezoneSearchQuery] = useState('')
  const [selectedTimezoneIndex, setSelectedTimezoneIndex] = useState(-1)

  // Simpler approach - we'll use this to store the initial values when the modal opens
  const [initialValues, setInitialValues] = useState<Record<string, any>>({})

  // Initialize initial values when the modal opens
  useEffect(() => {
    if (isOpen) {
      // Capture all current values when modal opens
      const currentValues = {
        scheduleType: scheduleType || 'daily',
        minutesInterval: minutesInterval || '',
        hourlyMinute: hourlyMinute || '',
        dailyTime: dailyTime || '',
        weeklyDay: weeklyDay || 'MON',
        weeklyDayTime: weeklyDayTime || '',
        monthlyDay: monthlyDay || '',
        monthlyTime: monthlyTime || '',
        timezone: timezone || 'UTC',
        cronExpression: cronExpression || '',
      }

      setInitialValues(currentValues)
      setHasChanges(false)
      setErrorMessage(null)
    }
  }, [isOpen])

  // Track changes - simplified approach
  useEffect(() => {
    if (!isOpen) return

    const currentValues = {
      scheduleType: scheduleType || 'daily',
      minutesInterval: minutesInterval || '',
      hourlyMinute: hourlyMinute || '',
      dailyTime: dailyTime || '',
      weeklyDay: weeklyDay || 'MON',
      weeklyDayTime: weeklyDayTime || '',
      monthlyDay: monthlyDay || '',
      monthlyTime: monthlyTime || '',
      timezone: timezone || 'UTC',
      cronExpression: cronExpression || '',
    }

    // Simple JSON comparison to detect any changes
    const valuesChanged = JSON.stringify(initialValues) !== JSON.stringify(currentValues)

    // For new schedules, consider them changed if any value is set based on schedule type
    if (!scheduleId) {
      let hasRequiredFields = false

      switch (currentValues.scheduleType) {
        case 'minutes':
          hasRequiredFields = !!currentValues.minutesInterval
          break
        case 'hourly':
          hasRequiredFields = currentValues.hourlyMinute !== ''
          break
        case 'daily':
          hasRequiredFields = !!currentValues.dailyTime
          break
        case 'weekly':
          hasRequiredFields = !!currentValues.weeklyDay && !!currentValues.weeklyDayTime
          break
        case 'monthly':
          hasRequiredFields = !!currentValues.monthlyDay && !!currentValues.monthlyTime
          break
        case 'custom':
          hasRequiredFields = !!currentValues.cronExpression
          break
      }

      setHasChanges(valuesChanged || hasRequiredFields)
    } else {
      setHasChanges(valuesChanged)
    }
  }, [
    isOpen,
    scheduleId,
    scheduleType,
    minutesInterval,
    hourlyMinute,
    dailyTime,
    weeklyDay,
    weeklyDayTime,
    monthlyDay,
    monthlyTime,
    timezone,
    cronExpression,
    initialValues,
  ])

  // Handle modal close
  const handleClose = () => {
    if (hasChanges) {
      setShowUnsavedChangesConfirm(true)
    } else {
      onClose()
    }
  }

  // Handle confirming close despite unsaved changes
  const handleConfirmClose = () => {
    // Revert form values to initial values
    if (hasChanges) {
      setScheduleType(initialValues.scheduleType)
      setMinutesInterval(initialValues.minutesInterval)
      setHourlyMinute(initialValues.hourlyMinute)
      setDailyTime(initialValues.dailyTime)
      setWeeklyDay(initialValues.weeklyDay)
      setWeeklyDayTime(initialValues.weeklyDayTime)
      setMonthlyDay(initialValues.monthlyDay)
      setMonthlyTime(initialValues.monthlyTime)
      setTimezone(initialValues.timezone)
      setCronExpression(initialValues.cronExpression)
    }

    setShowUnsavedChangesConfirm(false)
    onClose()
  }

  // Handle canceling the close
  const handleCancelClose = () => {
    setShowUnsavedChangesConfirm(false)
  }

  // Handle saving the schedule
  const handleSave = async () => {
    setErrorMessage(null)
    setIsSaving(true)

    try {
      // Validate inputs based on schedule type
      if (scheduleType === 'minutes' && !minutesInterval) {
        setErrorMessage('Please enter minutes interval')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'hourly' && hourlyMinute === '') {
        setErrorMessage('Please enter minute of the hour')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'daily' && !dailyTime) {
        setErrorMessage('Please enter time of day')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'weekly' && !weeklyDayTime) {
        setErrorMessage('Please enter time of day')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'monthly' && (!monthlyDay || !monthlyTime)) {
        setErrorMessage('Please enter day of month and time')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'custom' && !cronExpression) {
        setErrorMessage('Please enter a cron expression')
        setIsSaving(false)
        return
      }

      // Make sure the block's startWorkflow field is set to 'schedule'
      logger.debug('Current startWorkflow value:', startWorkflow)

      // Important: Set startWorkflow to 'schedule' in two ways for maximum reliability
      // 1. Via the hook which will trigger a state update
      if (startWorkflow !== 'schedule') {
        logger.debug('Setting startWorkflow to schedule via hook')
        setStartWorkflow('schedule')
      }

      // 2. Also directly set the value in the subblock store for immediate effect
      // This provides a more reliable way to ensure the value is set
      logger.debug('Setting startWorkflow to schedule directly in store')
      useSubBlockStore.getState().setValue(blockId, 'startWorkflow', 'schedule')

      // Give time for the state updates to propagate
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Call the onSave function passed from the parent component
      // This will handle the actual API call and store update
      const success = await onSave()

      if (success) {
        // Update initial values to match current state
        const updatedValues = {
          scheduleType: scheduleType || 'daily',
          minutesInterval: minutesInterval || '',
          hourlyMinute: hourlyMinute || '',
          dailyTime: dailyTime || '',
          weeklyDay: weeklyDay || 'MON',
          weeklyDayTime: weeklyDayTime || '',
          monthlyDay: monthlyDay || '',
          monthlyTime: monthlyTime || '',
          timezone: timezone || 'UTC',
          cronExpression: cronExpression || '',
        }
        logger.debug('Schedule saved successfully, updating initial values', updatedValues)
        setInitialValues(updatedValues)
        setHasChanges(false)
        onClose()
      }
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setErrorMessage('Failed to save schedule')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle deleting the schedule
  const handleDelete = async () => {
    if (!onDelete) return

    setIsDeleting(true)
    try {
      const success = await onDelete()

      if (success) {
        setShowDeleteConfirm(false)
        onClose()
      }
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setErrorMessage('Failed to delete schedule')
    } finally {
      setIsDeleting(false)
    }
  }

  // Open delete confirmation dialog
  const openDeleteConfirm = () => {
    setShowDeleteConfirm(true)
  }

  // Get current timezone label
  const getCurrentTimezoneLabel = () => {
    const currentTimezone = timezone || 'UTC'
    const timezoneOption = timezoneOptions.find((option) => option.value === currentTimezone)
    return timezoneOption ? timezoneOption.label : currentTimezone
  }

  return (
    <>
      <DialogContent className='flex flex-col gap-0 p-0 sm:max-w-[600px]' hideCloseButton>
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Schedule Configuration</DialogTitle>
            <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='overflow-y-auto px-6 pt-4 pb-6'>
          {errorMessage && (
            <Alert variant='destructive' className='mb-4'>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className='space-y-6'>
            {/* Frequency selector */}
            <div className='space-y-1'>
              <label htmlFor='scheduleType' className='font-medium text-sm'>
                Frequency
              </label>
              <Select
                value={scheduleType || 'daily'}
                onValueChange={(value) => setScheduleType(value)}
              >
                <SelectTrigger className='h-10'>
                  <SelectValue placeholder='Select frequency' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='minutes'>Every X Minutes</SelectItem>
                  <SelectItem value='hourly'>Hourly</SelectItem>
                  <SelectItem value='daily'>Daily</SelectItem>
                  <SelectItem value='weekly'>Weekly</SelectItem>
                  <SelectItem value='monthly'>Monthly</SelectItem>
                  <SelectItem value='custom'>Custom Cron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Minutes schedule options */}
            {scheduleType === 'minutes' && (
              <div className='space-y-1'>
                <label htmlFor='minutesInterval' className='font-medium text-sm'>
                  Run Every (minutes)
                </label>
                <Input
                  id='minutesInterval'
                  value={minutesInterval || ''}
                  onChange={(e) => setMinutesInterval(e.target.value)}
                  placeholder='15'
                  type='number'
                  min='1'
                  className='h-10'
                  autoComplete='off'
                  data-form-type='other'
                  name='minutes-interval'
                />
              </div>
            )}

            {/* Hourly schedule options */}
            {scheduleType === 'hourly' && (
              <div className='space-y-1'>
                <label htmlFor='hourlyMinute' className='font-medium text-sm'>
                  Minute of the Hour
                </label>
                <Input
                  id='hourlyMinute'
                  value={hourlyMinute || ''}
                  onChange={(e) => setHourlyMinute(e.target.value)}
                  placeholder='0'
                  type='number'
                  min='0'
                  max='59'
                  className='h-10'
                  autoComplete='off'
                  data-form-type='other'
                  name='hourly-minute'
                />
                <p className='text-muted-foreground text-xs'>
                  Specify which minute of each hour the workflow should run (0-59)
                </p>
              </div>
            )}

            {/* Daily schedule options */}
            {(scheduleType === 'daily' || !scheduleType) && (
              <div className='space-y-1'>
                <label htmlFor='dailyTime' className='font-medium text-sm'>
                  Time of Day
                </label>
                <TimeInput
                  blockId={blockId}
                  subBlockId='dailyTime'
                  placeholder='Select time'
                  className='h-10'
                />
              </div>
            )}

            {/* Weekly schedule options */}
            {scheduleType === 'weekly' && (
              <div className='space-y-4'>
                <div className='space-y-1'>
                  <label htmlFor='weeklyDay' className='font-medium text-sm'>
                    Day of Week
                  </label>
                  <Select value={weeklyDay || 'MON'} onValueChange={(value) => setWeeklyDay(value)}>
                    <SelectTrigger className='h-10'>
                      <SelectValue placeholder='Select day' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='MON'>Monday</SelectItem>
                      <SelectItem value='TUE'>Tuesday</SelectItem>
                      <SelectItem value='WED'>Wednesday</SelectItem>
                      <SelectItem value='THU'>Thursday</SelectItem>
                      <SelectItem value='FRI'>Friday</SelectItem>
                      <SelectItem value='SAT'>Saturday</SelectItem>
                      <SelectItem value='SUN'>Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1'>
                  <label htmlFor='weeklyDayTime' className='font-medium text-sm'>
                    Time of Day
                  </label>
                  <TimeInput
                    blockId={blockId}
                    subBlockId='weeklyDayTime'
                    placeholder='Select time'
                    className='h-10'
                  />
                </div>
              </div>
            )}

            {/* Monthly schedule options */}
            {scheduleType === 'monthly' && (
              <div className='space-y-4'>
                <div className='space-y-1'>
                  <label htmlFor='monthlyDay' className='font-medium text-sm'>
                    Day of Month
                  </label>
                  <Input
                    id='monthlyDay'
                    value={monthlyDay || ''}
                    onChange={(e) => setMonthlyDay(e.target.value)}
                    placeholder='1'
                    type='number'
                    min='1'
                    max='31'
                    className='h-10'
                    autoComplete='off'
                    data-form-type='other'
                    name='monthly-day'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Specify which day of the month the workflow should run (1-31)
                  </p>
                </div>

                <div className='space-y-1'>
                  <label htmlFor='monthlyTime' className='font-medium text-sm'>
                    Time of Day
                  </label>
                  <TimeInput
                    blockId={blockId}
                    subBlockId='monthlyTime'
                    placeholder='Select time'
                    className='h-10'
                  />
                </div>
              </div>
            )}

            {/* Custom cron options */}
            {scheduleType === 'custom' && (
              <div className='space-y-1'>
                <label htmlFor='cronExpression' className='font-medium text-sm'>
                  Cron Expression
                </label>
                <Input
                  id='cronExpression'
                  value={cronExpression || ''}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder='*/15 * * * *'
                  className='h-10'
                />
                <p className='mt-1 text-muted-foreground text-xs'>
                  Use standard cron format (e.g., "*/15 * * * *" for every 15 minutes)
                </p>
              </div>
            )}

            {/* Timezone configuration - only show for time-specific schedules */}
            {scheduleType !== 'minutes' && scheduleType !== 'hourly' && (
              <div className='space-y-1'>
                <label htmlFor='timezone' className='font-medium text-sm'>
                  Timezone
                </label>
                <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant='outline'
                      role='combobox'
                      aria-expanded={timezoneOpen}
                      className='h-10 w-full justify-between'
                    >
                      {getCurrentTimezoneLabel()}
                      <svg
                        className='ml-2 h-4 w-4 shrink-0 opacity-50'
                        xmlns='http://www.w3.org/2000/svg'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <polyline points='6,9 12,15 18,9' />
                      </svg>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className='w-[var(--radix-popover-trigger-width)] p-0'
                    align='start'
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <div className='flex flex-col bg-popover text-popover-foreground rounded-md border shadow-md'>
                      <div className='flex items-center border-b px-3'>
                        <Search className='mr-2 h-4 w-4 shrink-0 opacity-50' />
                        <input
                          placeholder='Search timezones...'
                          value={timezoneSearchQuery}
                          className='flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
                          onChange={(e) => {
                            setTimezoneSearchQuery(e.target.value)
                            setSelectedTimezoneIndex(-1) // Reset selection when searching
                          }}
                          onKeyDown={(e) => {
                            const filteredOptions = timezoneOptions.filter((option) => {
                              const searchTerm = timezoneSearchQuery.toLowerCase()
                              return (
                                option.label.toLowerCase().includes(searchTerm) ||
                                option.keywords.toLowerCase().includes(searchTerm)
                              )
                            })

                            switch (e.key) {
                              case 'ArrowDown':
                                e.preventDefault()
                                setSelectedTimezoneIndex((prev) =>
                                  prev < filteredOptions.length - 1 ? prev + 1 : 0
                                )
                                break
                              case 'ArrowUp':
                                e.preventDefault()
                                setSelectedTimezoneIndex((prev) =>
                                  prev > 0 ? prev - 1 : filteredOptions.length - 1
                                )
                                break
                              case 'Enter':
                                e.preventDefault()
                                if (
                                  selectedTimezoneIndex >= 0 &&
                                  filteredOptions[selectedTimezoneIndex]
                                ) {
                                  setTimezone(filteredOptions[selectedTimezoneIndex].value)
                                  setTimezoneOpen(false)
                                  setTimezoneSearchQuery('')
                                  setSelectedTimezoneIndex(-1)
                                }
                                break
                              case 'Escape':
                                e.preventDefault()
                                setTimezoneOpen(false)
                                setTimezoneSearchQuery('')
                                setSelectedTimezoneIndex(-1)
                                break
                            }
                          }}
                        />
                      </div>
                      <div
                        className='max-h-[300px] overflow-y-auto'
                        style={{
                          WebkitOverflowScrolling: 'touch',
                          scrollbarWidth: 'thin',
                          msOverflowStyle: 'none',
                          overscrollBehavior: 'contain',
                        }}
                        onWheel={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        {(() => {
                          const filteredOptions = timezoneOptions.filter((option) => {
                            const searchTerm = timezoneSearchQuery.toLowerCase()
                            return (
                              option.label.toLowerCase().includes(searchTerm) ||
                              option.keywords.toLowerCase().includes(searchTerm)
                            )
                          })

                          return filteredOptions.length === 0 ? (
                            <div className='py-6 text-center text-sm'>No timezone found.</div>
                          ) : (
                            <div className='p-1'>
                              {filteredOptions.map((option, index) => (
                                <button
                                  key={option.value}
                                  className={`relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${
                                    index === selectedTimezoneIndex
                                      ? 'bg-accent text-accent-foreground'
                                      : ''
                                  }`}
                                  onClick={() => {
                                    setTimezone(option.value)
                                    setTimezoneOpen(false)
                                    setTimezoneSearchQuery('')
                                    setSelectedTimezoneIndex(-1)
                                  }}
                                  onMouseEnter={() => setSelectedTimezoneIndex(index)}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className='w-full px-6 pt-0 pb-6'>
          <div className='flex w-full justify-between'>
            <div>
              {scheduleId && onDelete && (
                <Button
                  type='button'
                  variant='destructive'
                  onClick={openDeleteConfirm}
                  disabled={isDeleting || isSaving}
                  size='default'
                  className='h-10'
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  {isDeleting ? 'Deleting...' : 'Delete Schedule'}
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={handleClose} size='default' className='h-10'>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className={cn('h-10', hasChanges ? 'bg-primary hover:bg-primary/90' : '')}
                size='default'
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      <UnsavedChangesDialog
        open={showUnsavedChangesConfirm}
        setOpen={setShowUnsavedChangesConfirm}
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? 'Deleting...' : 'Delete Schedule'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
