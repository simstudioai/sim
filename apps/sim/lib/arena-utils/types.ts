export type DateRange = {
    startDate: string
    endDate: string
  }
  
  export type DateRangeWithTimestamps = DateRange & {
    startTimeStamp: number
    endTimeStamp: number
  }