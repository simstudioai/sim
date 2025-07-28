import { ScheduleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ScheduleBlock: BlockConfig = {
  type: 'schedule',
  name: 'Schedule',
  description: 'Trigger workflow execution on a schedule',
  longDescription:
    'Configure automated workflow execution with flexible timing options. Set up recurring workflows that run at specific intervals or times.',
  category: 'triggers',
  bgColor: '#7B68EE',
  icon: ScheduleIcon,

  subBlocks: [
    // Schedule configuration status display
    {
      id: 'scheduleConfig',
      title: 'Schedule Status',
      type: 'schedule-config',
      layout: 'full',
    },
    // Hidden fields for schedule configuration (used by the modal only)
    {
      id: 'scheduleType',
      title: 'Frequency',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Every X Minutes', id: 'minutes' },
        { label: 'Hourly', id: 'hourly' },
        { label: 'Daily', id: 'daily' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Monthly', id: 'monthly' },
        { label: 'Custom Cron', id: 'custom' },
      ],
      value: () => 'daily',
      hidden: true,
    },
    {
      id: 'minutesInterval',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'hourlyMinute',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'dailyTime',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'weeklyDay',
      type: 'dropdown',
      hidden: true,
      options: [
        { label: 'Monday', id: 'MON' },
        { label: 'Tuesday', id: 'TUE' },
        { label: 'Wednesday', id: 'WED' },
        { label: 'Thursday', id: 'THU' },
        { label: 'Friday', id: 'FRI' },
        { label: 'Saturday', id: 'SAT' },
        { label: 'Sunday', id: 'SUN' },
      ],
      value: () => 'MON',
    },
    {
      id: 'weeklyDayTime',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'monthlyDay',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'monthlyTime',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'cronExpression',
      type: 'short-input',
      hidden: true,
    },
    {
      id: 'timezone',
      type: 'dropdown',
      hidden: true,
      options: [
        { label: 'UTC', id: 'UTC' },

        // North America
        { label: 'US Eastern (UTC-4)', id: 'America/New_York' },
        { label: 'US Central (UTC-5)', id: 'America/Chicago' },
        { label: 'US Mountain (UTC-6)', id: 'America/Denver' },
        { label: 'US Pacific (UTC-7)', id: 'America/Los_Angeles' },
        { label: 'US Alaska (UTC-8)', id: 'America/Anchorage' },
        { label: 'US Hawaii (UTC-10)', id: 'Pacific/Honolulu' },
        { label: 'Canada Eastern (UTC-4)', id: 'America/Toronto' },
        { label: 'Canada Pacific (UTC-7)', id: 'America/Vancouver' },
        { label: 'Mexico City (UTC-5)', id: 'America/Mexico_City' },

        // South America
        { label: 'São Paulo (UTC-3)', id: 'America/Sao_Paulo' },
        { label: 'Buenos Aires (UTC-3)', id: 'America/Argentina/Buenos_Aires' },
        { label: 'Santiago (UTC-3)', id: 'America/Santiago' },
        { label: 'Lima (UTC-5)', id: 'America/Lima' },
        { label: 'Bogota (UTC-5)', id: 'America/Bogota' },

        // Europe
        { label: 'London (UTC+1)', id: 'Europe/London' },
        { label: 'Paris (UTC+2)', id: 'Europe/Paris' },
        { label: 'Berlin (UTC+2)', id: 'Europe/Berlin' },
        { label: 'Rome (UTC+2)', id: 'Europe/Rome' },
        { label: 'Madrid (UTC+2)', id: 'Europe/Madrid' },
        { label: 'Amsterdam (UTC+2)', id: 'Europe/Amsterdam' },
        { label: 'Brussels (UTC+2)', id: 'Europe/Brussels' },
        { label: 'Vienna (UTC+2)', id: 'Europe/Vienna' },
        { label: 'Zurich (UTC+2)', id: 'Europe/Zurich' },
        { label: 'Stockholm (UTC+2)', id: 'Europe/Stockholm' },
        { label: 'Oslo (UTC+2)', id: 'Europe/Oslo' },
        { label: 'Copenhagen (UTC+2)', id: 'Europe/Copenhagen' },
        { label: 'Helsinki (UTC+3)', id: 'Europe/Helsinki' },
        { label: 'Athens (UTC+3)', id: 'Europe/Athens' },
        { label: 'Prague (UTC+2)', id: 'Europe/Prague' },
        { label: 'Warsaw (UTC+2)', id: 'Europe/Warsaw' },
        { label: 'Budapest (UTC+2)', id: 'Europe/Budapest' },
        { label: 'Bucharest (UTC+3)', id: 'Europe/Bucharest' },
        { label: 'Sofia (UTC+3)', id: 'Europe/Sofia' },
        { label: 'Kiev (UTC+3)', id: 'Europe/Kiev' },
        { label: 'Moscow (UTC+3)', id: 'Europe/Moscow' },
        { label: 'Istanbul (UTC+3)', id: 'Europe/Istanbul' },

        // Africa
        { label: 'Cairo (UTC+3)', id: 'Africa/Cairo' },
        { label: 'Johannesburg (UTC+2)', id: 'Africa/Johannesburg' },
        { label: 'Lagos (UTC+1)', id: 'Africa/Lagos' },
        { label: 'Casablanca (UTC+1)', id: 'Africa/Casablanca' },
        { label: 'Nairobi (UTC+3)', id: 'Africa/Nairobi' },
        { label: 'Addis Ababa (UTC+3)', id: 'Africa/Addis_Ababa' },

        // Asia
        { label: 'Dubai (UTC+4)', id: 'Asia/Dubai' },
        { label: 'Tashkent (UTC+5)', id: 'Asia/Tashkent' },
        { label: 'Almaty (UTC+6)', id: 'Asia/Almaty' },
        { label: 'Novosibirsk (UTC+7)', id: 'Asia/Novosibirsk' },
        { label: 'Krasnoyarsk (UTC+7)', id: 'Asia/Krasnoyarsk' },
        { label: 'Irkutsk (UTC+8)', id: 'Asia/Irkutsk' },
        { label: 'Yakutsk (UTC+9)', id: 'Asia/Yakutsk' },
        { label: 'Vladivostok (UTC+10)', id: 'Asia/Vladivostok' },
        { label: 'Magadan (UTC+11)', id: 'Asia/Magadan' },
        { label: 'Kamchatka (UTC+12)', id: 'Asia/Kamchatka' },
        { label: 'Tehran (UTC+3:30)', id: 'Asia/Tehran' },
        { label: 'Kabul (UTC+4:30)', id: 'Asia/Kabul' },
        { label: 'Kolkata (UTC+5:30)', id: 'Asia/Kolkata' },
        { label: 'Kathmandu (UTC+5:45)', id: 'Asia/Kathmandu' },
        { label: 'Dhaka (UTC+6)', id: 'Asia/Dhaka' },
        { label: 'Yangon (UTC+6:30)', id: 'Asia/Yangon' },
        { label: 'Bangkok (UTC+7)', id: 'Asia/Bangkok' },
        { label: 'Ho Chi Minh (UTC+7)', id: 'Asia/Ho_Chi_Minh' },
        { label: 'Jakarta (UTC+7)', id: 'Asia/Jakarta' },
        { label: 'Manila (UTC+8)', id: 'Asia/Manila' },
        { label: 'Singapore (UTC+8)', id: 'Asia/Singapore' },
        { label: 'Kuala Lumpur (UTC+8)', id: 'Asia/Kuala_Lumpur' },
        { label: 'Hong Kong (UTC+8)', id: 'Asia/Hong_Kong' },
        { label: 'Shanghai (UTC+8)', id: 'Asia/Shanghai' },
        { label: 'Seoul (UTC+9)', id: 'Asia/Seoul' },
        { label: 'Tokyo (UTC+9)', id: 'Asia/Tokyo' },
        { label: 'Pyongyang (UTC+9)', id: 'Asia/Pyongyang' },
        { label: 'Ulaanbaatar (UTC+8)', id: 'Asia/Ulaanbaatar' },

        // Oceania
        { label: 'Perth (UTC+8)', id: 'Australia/Perth' },
        { label: 'Adelaide (UTC+9:30)', id: 'Australia/Adelaide' },
        { label: 'Darwin (UTC+9:30)', id: 'Australia/Darwin' },
        { label: 'Brisbane (UTC+10)', id: 'Australia/Brisbane' },
        { label: 'Sydney (UTC+10)', id: 'Australia/Sydney' },
        { label: 'Melbourne (UTC+10)', id: 'Australia/Melbourne' },
        { label: 'Hobart (UTC+10)', id: 'Australia/Hobart' },
        { label: 'Lord Howe (UTC+10:30)', id: 'Australia/Lord_Howe' },
        { label: 'Auckland (UTC+12)', id: 'Pacific/Auckland' },
        { label: 'Fiji (UTC+12)', id: 'Pacific/Fiji' },
        { label: 'Guam (UTC+10)', id: 'Pacific/Guam' },
        { label: 'Port Moresby (UTC+10)', id: 'Pacific/Port_Moresby' },
        { label: 'Noumea (UTC+11)', id: 'Pacific/Noumea' },
        { label: 'Norfolk (UTC+11)', id: 'Pacific/Norfolk' },
        { label: 'Tarawa (UTC+12)', id: 'Pacific/Tarawa' },
        { label: 'Kwajalein (UTC+12)', id: 'Pacific/Kwajalein' },
        { label: 'Apia (UTC+13)', id: 'Pacific/Apia' },
        { label: 'Kiritimati (UTC+14)', id: 'Pacific/Kiritimati' },
      ],
      value: () => 'UTC',
    },
  ],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - schedule triggers initiate workflows

  outputs: {}, // No outputs - schedule triggers initiate workflow execution
}
