import type { GetTravelProfileParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getTravelProfileTool: ToolConfig<GetTravelProfileParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_travel_profile',
  name: 'SAP Concur Get Travel Profile',
  description:
    'Get a travel profile (GET /api/travelprofile/v2.0/profile). Returns the calling user by default; pass userid_type and userid_value to impersonate.',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    useridType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier type: login, xmlsyncid, or uuid',
    },
    useridValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier value (login id, xml sync id, or UUID)',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const query = buildListQuery({
        userid_type: params.useridType,
        userid_value: params.useridValue,
      })
      return {
        ...baseProxyBody(params),
        path: '/api/travelprofile/v2.0/profile',
        method: 'GET',
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description:
        'Travel profile payload. Concur returns XML; downstream may parse it to a best-effort JSON object with the documented top-level sections.',
      properties: {
        General: {
          type: 'json',
          description:
            'General profile info (NamePrefix, FirstName, MiddleName, LastName, NameSuffix, JobTitle, CompanyEmployeeID, EmailAddress, RuleClass, TravelConfigID, etc.)',
          optional: true,
        },
        Telephones: {
          type: 'json',
          description: 'Telephone numbers (Telephone[] with Type, CountryCode, PhoneNumber, etc.)',
          optional: true,
        },
        Addresses: {
          type: 'json',
          description: 'Address records (Address[] with Type, Street, City, StateProvince, etc.)',
          optional: true,
        },
        DriversLicenses: {
          type: 'array',
          description: 'Drivers license records',
          optional: true,
          items: { type: 'json' },
        },
        NationalIDs: {
          type: 'array',
          description: 'National ID records',
          optional: true,
          items: { type: 'json' },
        },
        EmailAddresses: {
          type: 'json',
          description: 'Email addresses (EmailAddress[] with Type, Address, Contact, Verified)',
          optional: true,
        },
        EmergencyContact: {
          type: 'json',
          description: 'Emergency contact (Name, Relationship, Phones, Address)',
          optional: true,
        },
        Air: {
          type: 'json',
          description: 'Air travel preferences (HomeAirport, Seat, Meal, AirOther, AirMemberships)',
          optional: true,
        },
        Rail: {
          type: 'json',
          description: 'Rail preferences (Seat, Coach, Berth, Other, RailMemberships)',
          optional: true,
        },
        Hotel: {
          type: 'json',
          description:
            'Hotel preferences (SmokingCode, RoomType, HotelOther, HotelMemberships, Accessibility flags)',
          optional: true,
        },
        Car: {
          type: 'json',
          description: 'Car rental preferences (CarSmokingCode, CarType, CarMemberships, etc.)',
          optional: true,
        },
        CustomFields: {
          type: 'json',
          description: 'Custom-defined fields configured by the company',
          optional: true,
        },
        RatePreferences: {
          type: 'json',
          description: 'Rate preferences (e.g. AAA, AARP, government, military rates)',
          optional: true,
        },
        DiscountCodes: {
          type: 'json',
          description: 'Discount codes available to the traveler',
          optional: true,
        },
        HasNoPassport: {
          type: 'boolean',
          description: 'Whether the traveler has no passport on file',
          optional: true,
        },
        Roles: {
          type: 'json',
          description: 'Role assignments (TravelManager, Assistant, etc.)',
          optional: true,
        },
        Sponsors: {
          type: 'json',
          description: 'Sponsor information for guest travelers',
          optional: true,
        },
        TSAInfo: {
          type: 'json',
          description: 'TSA SecureFlight info (Gender, DateOfBirth, NoMiddleName, etc.)',
          optional: true,
        },
        Passports: {
          type: 'json',
          description: 'Passport documents (Passport[] with PassportNumber, Country, Expiration)',
          optional: true,
        },
        Visas: {
          type: 'json',
          description: 'Visa documents (Visa[] with VisaNationality, VisaNumber, etc.)',
          optional: true,
        },
        UnusedTickets: {
          type: 'json',
          description: 'Unused ticket records',
          optional: true,
        },
        SouthwestUnusedTickets: {
          type: 'json',
          description: 'Southwest-specific unused ticket records',
          optional: true,
        },
        AdvantageMemberships: {
          type: 'json',
          description: 'Advantage program memberships',
          optional: true,
        },
        XmlSyncId: {
          type: 'string',
          description: 'XML sync identifier for the user',
          optional: true,
        },
        LoginId: {
          type: 'string',
          description: 'Concur login id',
          optional: true,
        },
        ProfileLastModifiedUTC: {
          type: 'string',
          description: 'UTC timestamp the profile was last modified',
          optional: true,
        },
      },
    },
  },
}
