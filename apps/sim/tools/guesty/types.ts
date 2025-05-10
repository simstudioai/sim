import { ToolResponse } from "../types"

export interface GuestyGuestParams {
    apiKey: string
    phoneNumber: string
  }
  
  export interface GuestyGuestResponse extends ToolResponse {
    output: {
      guests: Array<{
        id: string
        fullName: string
        email: string
        phone: string
        address: string
        city: string
        country: string
      }>
    }
  }

  export interface GuestyReservationParams {
    apiKey: string
    reservationId: string
  }
  
  export interface GuestyReservationResponse extends ToolResponse {
    output: {
      id: string
      guest: {
        fullName: string
        email: string
        phone: string
      }
      checkIn: string
      checkOut: string
      status: string
      listing: {
        id: string
        title: string
      }
      money: {
        totalPaid: number
        currency: string
      }
    }
  }