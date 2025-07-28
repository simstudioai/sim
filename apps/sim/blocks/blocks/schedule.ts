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

        // UTC-10 to UTC-3 (Western Hemisphere)
        { label: 'US Hawaii (UTC-10)', id: 'Pacific/Honolulu' },
        { label: 'US Alaska (UTC-8)', id: 'America/Anchorage' },
        { label: 'US Pacific (UTC-7/-8)', id: 'America/Los_Angeles' },
        { label: 'Canada Pacific (UTC-7/-8)', id: 'America/Vancouver' },
        { label: 'US Mountain (UTC-6/-7)', id: 'America/Denver' },
        { label: 'US Central (UTC-5/-6)', id: 'America/Chicago' },
        { label: 'Mexico City (UTC-5/-6)', id: 'America/Mexico_City' },
        { label: 'Bogota (UTC-5)', id: 'America/Bogota' },
        { label: 'Lima (UTC-5)', id: 'America/Lima' },
        { label: 'US Eastern (UTC-4/-5)', id: 'America/New_York' },
        { label: 'Canada Eastern (UTC-4/-5)', id: 'America/Toronto' },
        { label: 'São Paulo (UTC-2/-3)', id: 'America/Sao_Paulo' },
        { label: 'Buenos Aires (UTC-3)', id: 'America/Argentina/Buenos_Aires' },
        { label: 'Santiago (UTC-3/-4)', id: 'America/Santiago' },

        // UTC+1 to UTC+3 (Europe & Africa)
        { label: 'London (UTC+0/+1)', id: 'Europe/London' },
        { label: 'Lagos (UTC+1)', id: 'Africa/Lagos' },
        { label: 'Casablanca (UTC+0/+1)', id: 'Africa/Casablanca' },
        { label: 'Paris (UTC+1/+2)', id: 'Europe/Paris' },
        { label: 'Berlin (UTC+1/+2)', id: 'Europe/Berlin' },
        { label: 'Rome (UTC+1/+2)', id: 'Europe/Rome' },
        { label: 'Madrid (UTC+1/+2)', id: 'Europe/Madrid' },
        { label: 'Amsterdam (UTC+1/+2)', id: 'Europe/Amsterdam' },
        { label: 'Brussels (UTC+1/+2)', id: 'Europe/Brussels' },
        { label: 'Vienna (UTC+1/+2)', id: 'Europe/Vienna' },
        { label: 'Zurich (UTC+1/+2)', id: 'Europe/Zurich' },
        { label: 'Stockholm (UTC+1/+2)', id: 'Europe/Stockholm' },
        { label: 'Oslo (UTC+1/+2)', id: 'Europe/Oslo' },
        { label: 'Copenhagen (UTC+1/+2)', id: 'Europe/Copenhagen' },
        { label: 'Prague (UTC+1/+2)', id: 'Europe/Prague' },
        { label: 'Warsaw (UTC+1/+2)', id: 'Europe/Warsaw' },
        { label: 'Budapest (UTC+1/+2)', id: 'Europe/Budapest' },
        { label: 'Johannesburg (UTC+2)', id: 'Africa/Johannesburg' },
        { label: 'Helsinki (UTC+2/+3)', id: 'Europe/Helsinki' },
        { label: 'Athens (UTC+2/+3)', id: 'Europe/Athens' },
        { label: 'Bucharest (UTC+2/+3)', id: 'Europe/Bucharest' },
        { label: 'Sofia (UTC+2/+3)', id: 'Europe/Sofia' },
        { label: 'Kiev (UTC+2/+3)', id: 'Europe/Kiev' },
        { label: 'Moscow (UTC+3)', id: 'Europe/Moscow' },
        { label: 'Istanbul (UTC+3)', id: 'Europe/Istanbul' },
        { label: 'Cairo (UTC+2/+3)', id: 'Africa/Cairo' },
        { label: 'Nairobi (UTC+3)', id: 'Africa/Nairobi' },
        { label: 'Addis Ababa (UTC+3)', id: 'Africa/Addis_Ababa' },
        { label: 'Tehran (UTC+3:30/+4:30)', id: 'Asia/Tehran' },

        // UTC+4 to UTC+6 (Central Asia)
        { label: 'Dubai (UTC+4)', id: 'Asia/Dubai' },
        { label: 'Kabul (UTC+4:30)', id: 'Asia/Kabul' },
        { label: 'Tashkent (UTC+5)', id: 'Asia/Tashkent' },
        { label: 'Kolkata (UTC+5:30)', id: 'Asia/Kolkata' },
        { label: 'Kathmandu (UTC+5:45)', id: 'Asia/Kathmandu' },
        { label: 'Almaty (UTC+6)', id: 'Asia/Almaty' },
        { label: 'Dhaka (UTC+6)', id: 'Asia/Dhaka' },
        { label: 'Yangon (UTC+6:30)', id: 'Asia/Yangon' },

        // UTC+7 to UTC+9 (Southeast & East Asia)
        { label: 'Novosibirsk (UTC+6/+7)', id: 'Asia/Novosibirsk' },
        { label: 'Krasnoyarsk (UTC+7/+8)', id: 'Asia/Krasnoyarsk' },
        { label: 'Bangkok (UTC+7)', id: 'Asia/Bangkok' },
        { label: 'Ho Chi Minh (UTC+7)', id: 'Asia/Ho_Chi_Minh' },
        { label: 'Jakarta (UTC+7)', id: 'Asia/Jakarta' },
        { label: 'Irkutsk (UTC+8/+9)', id: 'Asia/Irkutsk' },
        { label: 'Manila (UTC+8)', id: 'Asia/Manila' },
        { label: 'Singapore (UTC+8)', id: 'Asia/Singapore' },
        { label: 'Kuala Lumpur (UTC+8)', id: 'Asia/Kuala_Lumpur' },
        { label: 'Hong Kong (UTC+8)', id: 'Asia/Hong_Kong' },
        { label: 'Shanghai (UTC+8)', id: 'Asia/Shanghai' },
        { label: 'Ulaanbaatar (UTC+8)', id: 'Asia/Ulaanbaatar' },
        { label: 'Perth (UTC+8)', id: 'Australia/Perth' },
        { label: 'Yakutsk (UTC+9/+10)', id: 'Asia/Yakutsk' },
        { label: 'Seoul (UTC+9)', id: 'Asia/Seoul' },
        { label: 'Tokyo (UTC+9)', id: 'Asia/Tokyo' },
        { label: 'Pyongyang (UTC+9)', id: 'Asia/Pyongyang' },

        // UTC+10 to UTC+14 (Oceania & Pacific)
        { label: 'Adelaide (UTC+9:30/+10:30)', id: 'Australia/Adelaide' },
        { label: 'Darwin (UTC+9:30)', id: 'Australia/Darwin' },
        { label: 'Brisbane (UTC+10)', id: 'Australia/Brisbane' },
        { label: 'Sydney (UTC+10/+11)', id: 'Australia/Sydney' },
        { label: 'Melbourne (UTC+10/+11)', id: 'Australia/Melbourne' },
        { label: 'Hobart (UTC+10/+11)', id: 'Australia/Hobart' },
        { label: 'Guam (UTC+10)', id: 'Pacific/Guam' },
        { label: 'Port Moresby (UTC+10)', id: 'Pacific/Port_Moresby' },
        { label: 'Lord Howe (UTC+10:30/+11)', id: 'Australia/Lord_Howe' },
        { label: 'Vladivostok (UTC+10/+11)', id: 'Asia/Vladivostok' },
        { label: 'Magadan (UTC+11/+12)', id: 'Asia/Magadan' },
        { label: 'Noumea (UTC+11)', id: 'Pacific/Noumea' },
        { label: 'Norfolk (UTC+11)', id: 'Pacific/Norfolk' },
        { label: 'Kamchatka (UTC+12)', id: 'Asia/Kamchatka' },
        { label: 'Auckland (UTC+12/+13)', id: 'Pacific/Auckland' },
        { label: 'Fiji (UTC+12)', id: 'Pacific/Fiji' },
        { label: 'Tarawa (UTC+12)', id: 'Pacific/Tarawa' },
        { label: 'Kwajalein (UTC+12)', id: 'Pacific/Kwajalein' },
        { label: 'Apia (UTC+13/+14)', id: 'Pacific/Apia' },
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
