import type { DateRange, DateRangeWithTimestamps } from '@/lib/arena-utils/types'

const toStartOfDayString = (date: Date) => {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// ---------- Types ----------

export const getToday = () => {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // normalize to midnight

  // Start = today + 9 hours
  const start = new Date(today)
  start.setHours(9, 0, 0, 0)

  // End = today + 18 hours
  const end = new Date(today)
  end.setHours(18, 0, 0, 0)

  return {
    startDate: toStartOfDayString(start),
    startTimeStamp: start.getTime(),
    endDate: toStartOfDayString(end),
    endTimeStamp: end.getTime(),
  }
}

export const getLastWeek = (): DateRange => {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // normalize to midnight

  const todayDay = today.getDay() // Sunday=0, Monday=1, ..., Saturday=6

  // Find last Sunday's date
  const lastSunday = new Date(today)
  lastSunday.setDate(today.getDate() - todayDay - 7)

  // Last week's Saturday is 6 days after that Sunday
  const lastSaturday = new Date(lastSunday)
  lastSaturday.setDate(lastSunday.getDate() + 6)

  return {
    startDate: toStartOfDayString(lastSunday),
    endDate: toStartOfDayString(lastSaturday),
  }
}

export const getLastMonth = (): DateRange => {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // normalize to midnight

  // Move back one month
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)

  // Start of last month
  const start = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), 1)

  // End of last month (day 0 of the current month gives last day of previous month)
  const end = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0)

  return {
    startDate: toStartOfDayString(start),
    endDate: toStartOfDayString(end),
  }
}

// Next Week (Monday to Friday)
export const getNextWeek = (): DateRangeWithTimestamps => {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // normalize to midnight

  const todayDay = today.getDay() // Sunday=0 ... Saturday=6

  // Next Sunday's date (start of next week)
  const nextSunday = new Date(today)
  nextSunday.setDate(today.getDate() - todayDay + 7) // jump to next Sunday
  nextSunday.setHours(0, 0, 0, 0)

  // Next Saturday (end of next week, 6 days later)
  const nextSaturday = new Date(nextSunday)
  nextSaturday.setDate(nextSunday.getDate() + 6)
  nextSaturday.setHours(23, 59, 59, 999)

  return {
    startDate: toStartOfDayString(nextSunday),
    endDate: toStartOfDayString(nextSaturday),
    startTimeStamp: nextSunday.getTime(),
    endTimeStamp: nextSaturday.getTime(),
  }
}

// Next Month (first weekday to last weekday)
export const getNextMonth = (): DateRangeWithTimestamps => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  const lastOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0)

  let firstNonWeekend = new Date(firstOfNextMonth)
  while (firstNonWeekend.getDay() === 0 || firstNonWeekend.getDay() === 6) {
    firstNonWeekend = addDays(firstNonWeekend, 1)
  }
  firstNonWeekend.setHours(9, 0, 0, 0)

  let lastNonWeekend = new Date(lastOfNextMonth)
  while (lastNonWeekend.getDay() === 0 || lastNonWeekend.getDay() === 6) {
    lastNonWeekend = addDays(lastNonWeekend, -1)
  }
  lastNonWeekend.setHours(18, 0, 0, 0)

  return {
    startDate: toStartOfDayString(firstNonWeekend),
    endDate: toStartOfDayString(lastNonWeekend),
    startTimeStamp: firstNonWeekend.getTime(),
    endTimeStamp: lastNonWeekend.getTime(),
  }
}

// Yesterday
export const getYesterday = (): string => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = addDays(today, -1)
  return toStartOfDayString(yesterday)
}

// Tomorrow (9:00 → 18:00)
export const getTomorrow = (): DateRangeWithTimestamps => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const startDate = addDays(today, 1)
  startDate.setHours(9, 0, 0, 0)

  const endDate = addDays(today, 1)
  endDate.setHours(18, 0, 0, 0)

  return {
    startDate: toStartOfDayString(startDate),
    startTimeStamp: startDate.getTime(),
    endDate: toStartOfDayString(endDate),
    endTimeStamp: endDate.getTime(),
  }
}

// Current Week (Monday to Friday)
export const getCurrentWeek = (): DateRangeWithTimestamps => {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // normalize to midnight

  const todayDay = today.getDay() // Sunday=0 ... Saturday=6

  // Start of current week (Sunday)
  const currentSunday = new Date(today)
  currentSunday.setDate(today.getDate() - todayDay)
  currentSunday.setHours(0, 0, 0, 0)

  // End of current week (Saturday)
  const currentSaturday = new Date(currentSunday)
  currentSaturday.setDate(currentSunday.getDate() + 6)
  currentSaturday.setHours(23, 59, 59, 999)

  return {
    startDate: toStartOfDayString(currentSunday),
    endDate: toStartOfDayString(currentSaturday),
    startTimeStamp: currentSunday.getTime(),
    endTimeStamp: currentSaturday.getTime(),
  }
}

// Current Month (first weekday to last weekday)
export const getCurrentMonth = (): DateRangeWithTimestamps => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  let firstNonWeekend = new Date(startOfMonth)
  while (firstNonWeekend.getDay() === 0 || firstNonWeekend.getDay() === 6) {
    firstNonWeekend = addDays(firstNonWeekend, 1)
  }
  firstNonWeekend.setHours(9, 0, 0, 0)

  let lastNonWeekend = new Date(endOfMonth)
  while (lastNonWeekend.getDay() === 0 || lastNonWeekend.getDay() === 6) {
    lastNonWeekend = addDays(lastNonWeekend, -1)
  }
  lastNonWeekend.setHours(18, 0, 0, 0)

  return {
    startDate: toStartOfDayString(firstNonWeekend),
    endDate: toStartOfDayString(lastNonWeekend),
    startTimeStamp: firstNonWeekend.getTime(),
    endTimeStamp: lastNonWeekend.getTime(),
  }
}

// Past Date (from 8 months ago start → 2 months ago end)
export const getPastDate = (): DateRange => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const start = new Date(today.getFullYear(), today.getMonth() - 8, 1)
  const end = new Date(today.getFullYear(), today.getMonth() - 1, 0)

  return {
    startDate: toStartOfDayString(start),
    endDate: toStartOfDayString(end),
  }
}

// Future Date (2 months → 8 months range, weekdays only)
export const getFutureDate = (): DateRangeWithTimestamps => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const futureStartDate = new Date(today.getFullYear(), today.getMonth() + 2, 1)
  const futureEndDate = new Date(today.getFullYear(), today.getMonth() + 9, 0)

  let firstNonWeekend = new Date(futureStartDate)
  while (firstNonWeekend.getDay() === 0 || firstNonWeekend.getDay() === 6) {
    firstNonWeekend = addDays(firstNonWeekend, 1)
  }
  firstNonWeekend.setHours(9, 0, 0, 0)

  let lastNonWeekend = new Date(futureEndDate)
  while (lastNonWeekend.getDay() === 0 || lastNonWeekend.getDay() === 6) {
    lastNonWeekend = addDays(lastNonWeekend, -1)
  }
  lastNonWeekend.setHours(18, 0, 0, 0)

  return {
    startDate: toStartOfDayString(firstNonWeekend),
    endDate: toStartOfDayString(lastNonWeekend),
    startTimeStamp: firstNonWeekend.getTime(),
    endTimeStamp: lastNonWeekend.getTime(),
  }
}
