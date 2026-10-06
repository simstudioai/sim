import { PLANEV2PROJECTS80208C_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Projects80208cSchema } from '@/tools/plane/schemas'
import type { PlaneCreateProjectParams, PlaneCreateProjectResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeCreateProjectTool: ToolConfig<
  PlaneCreateProjectParams,
  PlaneCreateProjectResponse
> = {
  id: 'plane_create_project',
  name: 'Plane Create a project',
  description: 'Create a project in Plane. Supports API v1 compatibility.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Short project key used to prefix work item numbers, for example `ENG` in `ENG-142`. Maximum 255 characters.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    archive_in: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The archive in.',
    },
    close_in: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The close in.',
    },
    cover_image: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL of the cover image. Nullable.',
    },
    cycle_view: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether cycle view.',
    },
    default_assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related default assignee. Nullable.',
    },
    default_state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related default state. Nullable.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description.',
    },
    emoji: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emoji shown alongside the name. Maximum 255 characters. Nullable.',
    },
    estimate_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related estimate. Nullable.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this record, for sync and import correlation. Maximum 255 characters. Nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable.',
    },
    guest_view_all_features: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether guest view all features.',
    },
    icon_prop: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The icon prop. Nullable.',
    },
    intake_view: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether intake view.',
    },
    is_issue_type_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is issue type enabled.',
    },
    is_time_tracking_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is time tracking enabled.',
    },
    issue_views_view: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether issue views view.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    module_view: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether module view.',
    },
    network: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Project visibility: `0` is private to members, `2` is visible to the whole workspace.',
    },
    page_view: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether page view.',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `none` - None - `low` - Low - `medium` - Medium - `high` - High - `urgent` - Urgent One of `none`, `low`, `medium`, `high`, `urgent`.',
    },
    project_lead_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related project lead. Nullable.',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start date, as `YYYY-MM-DD`. Nullable.',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related state. Nullable.',
    },
    target_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned due date, as `YYYY-MM-DD`. Nullable.',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `Africa/Abidjan` - Africa/Abidjan - `Africa/Accra` - Africa/Accra - `Africa/Addis_Ababa` - Africa/Addis_Ababa - `Africa/Algiers` - Africa/Algiers - `Africa/Asmara` - Africa/Asmara - `Africa/Bamako` - Africa/Bamako - `Africa/Bangui` - Africa/Bangui - `Africa/Banjul` - Africa/Banjul - `Africa/Bissau` - Africa/Bissau - `Africa/Blantyre` - Africa/Blantyre - `Africa/Brazzaville` - Africa/Brazzaville - `Africa/Bujumbura` - Africa/Bujumbura - `Africa/Cairo` - Africa/Cairo - `Africa/Casablanca` - Africa/Casablanca - `Africa/Ceuta` - Africa/Ceuta - `Africa/Conakry` - Africa/Conakry - `Africa/Dakar` - Africa/Dakar - `Africa/Dar_es_Salaam` - Africa/Dar_es_Salaam - `Africa/Djibouti` - Africa/Djibouti - `Africa/Douala` - Africa/Douala - `Africa/El_Aaiun` - Africa/El_Aaiun - `Africa/Freetown` - Africa/Freetown - `Africa/Gaborone` - Africa/Gaborone - `Africa/Harare` - Africa/Harare - `Africa/Johannesburg` - Africa/Johannesburg - `Africa/Juba` - Africa/Juba - `Africa/Kampala` - Africa/Kampala - `Africa/Khartoum` - Africa/Khartoum - `Africa/Kigali` - Africa/Kigali - `Africa/Kinshasa` - Africa/Kinshasa - `Africa/Lagos` - Africa/Lagos - `Africa/Libreville` - Africa/Libreville - `Africa/Lome` - Africa/Lome - `Africa/Luanda` - Africa/Luanda - `Africa/Lubumbashi` - Africa/Lubumbashi - `Africa/Lusaka` - Africa/Lusaka - `Africa/Malabo` - Africa/Malabo - `Africa/Maputo` - Africa/Maputo - `Africa/Maseru` - Africa/Maseru - `Africa/Mbabane` - Africa/Mbabane - `Africa/Mogadishu` - Africa/Mogadishu - `Africa/Monrovia` - Africa/Monrovia - `Africa/Nairobi` - Africa/Nairobi - `Africa/Ndjamena` - Africa/Ndjamena - `Africa/Niamey` - Africa/Niamey - `Africa/Nouakchott` - Africa/Nouakchott - `Africa/Ouagadougou` - Africa/Ouagadougou - `Africa/Porto-Novo` - Africa/Porto-Novo - `Africa/Sao_Tome` - Africa/Sao_Tome - `Africa/Tripoli` - Africa/Tripoli - `Africa/Tunis` - Africa/Tunis - `Africa/Windhoek` - Africa/Windhoek - `America/Adak` - America/Adak - `America/Anchorage` - America/Anchorage - `America/Anguilla` - America/Anguilla - `America/Antigua` - America/Antigua - `America/Araguaina` - America/Araguaina - `America/Argentina/Buenos_Aires` - America/Argentina/Buenos_Aires - `America/Argentina/Catamarca` - America/Argentina/Catamarca - `America/Argentina/Cordoba` - America/Argentina/Cordoba - `America/Argentina/Jujuy` - America/Argentina/Jujuy - `America/Argentina/La_Rioja` - America/Argentina/La_Rioja - `America/Argentina/Mendoza` - America/Argentina/Mendoza - `America/Argentina/Rio_Gallegos` - America/Argentina/Rio_Gallegos - `America/Argentina/Salta` - America/Argentina/Salta - `America/Argentina/San_Juan` - America/Argentina/San_Juan - `America/Argentina/San_Luis` - America/Argentina/San_Luis - `America/Argentina/Tucuman` - America/Argentina/Tucuman - `America/Argentina/Ushuaia` - America/Argentina/Ushuaia - `America/Aruba` - America/Aruba - `America/Asuncion` - America/Asuncion - `America/Atikokan` - America/Atikokan - `America/Bahia` - America/Bahia - `America/Bahia_Banderas` - America/Bahia_Banderas - `America/Barbados` - America/Barbados - `America/Belem` - America/Belem - `America/Belize` - America/Belize - `America/Blanc-Sablon` - America/Blanc-Sablon - `America/Boa_Vista` - America/Boa_Vista - `America/Bogota` - America/Bogota - `America/Boise` - America/Boise - `America/Cambridge_Bay` - America/Cambridge_Bay - `America/Campo_Grande` - America/Campo_Grande - `America/Cancun` - America/Cancun - `America/Caracas` - America/Caracas - `America/Cayenne` - America/Cayenne - `America/Cayman` - America/Cayman - `America/Chicago` - America/Chicago - `America/Chihuahua` - America/Chihuahua - `America/Ciudad_Juarez` - America/Ciudad_Juarez - `America/Costa_Rica` - America/Costa_Rica - `America/Creston` - America/Creston - `America/Cuiaba` - America/Cuiaba - `America/Curacao` - America/Curacao - `America/Danmarkshavn` - America/Danmarkshavn - `America/Dawson` - America/Dawson - `America/Dawson_Creek` - America/Dawson_Creek - `America/Denver` - America/Denver - `America/Detroit` - America/Detroit - `America/Dominica` - America/Dominica - `America/Edmonton` - America/Edmonton - `America/Eirunepe` - America/Eirunepe - `America/El_Salvador` - America/El_Salvador - `America/Fort_Nelson` - America/Fort_Nelson - `America/Fortaleza` - America/Fortaleza - `America/Glace_Bay` - America/Glace_Bay - `America/Goose_Bay` - America/Goose_Bay - `America/Grand_Turk` - America/Grand_Turk - `America/Grenada` - America/Grenada - `America/Guadeloupe` - America/Guadeloupe - `America/Guatemala` - America/Guatemala - `America/Guayaquil` - America/Guayaquil - `America/Guyana` - America/Guyana - `America/Halifax` - America/Halifax - `America/Havana` - America/Havana - `America/Hermosillo` - America/Hermosillo - `America/Indiana/Indianapolis` - America/Indiana/Indianapolis - `America/Indiana/Knox` - America/Indiana/Knox - `America/Indiana/Marengo` - America/Indiana/Marengo - `America/Indiana/Petersburg` - America/Indiana/Petersburg - `America/Indiana/Tell_City` - America/Indiana/Tell_City - `America/Indiana/Vevay` - America/Indiana/Vevay - `America/Indiana/Vincennes` - America/Indiana/Vincennes - `America/Indiana/Winamac` - America/Indiana/Winamac - `America/Inuvik` - America/Inuvik - `America/Iqaluit` - America/Iqaluit - `America/Jamaica` - America/Jamaica - `America/Juneau` - America/Juneau - `America/Kentucky/Louisville` - America/Kentucky/Louisville - `America/Kentucky/Monticello` - America/Kentucky/Monticello - `America/Kralendijk` - America/Kralendijk - `America/La_Paz` - America/La_Paz - `America/Lima` - America/Lima - `America/Los_Angeles` - America/Los_Angeles - `America/Lower_Princes` - America/Lower_Princes - `America/Maceio` - America/Maceio - `America/Managua` - America/Managua - `America/Manaus` - America/Manaus - `America/Marigot` - America/Marigot - `America/Martinique` - America/Martinique - `America/Matamoros` - America/Matamoros - `America/Mazatlan` - America/Mazatlan - `America/Menominee` - America/Menominee - `America/Merida` - America/Merida - `America/Metlakatla` - America/Metlakatla - `America/Mexico_City` - America/Mexico_City - `America/Miquelon` - America/Miquelon - `America/Moncton` - America/Moncton - `America/Monterrey` - America/Monterrey - `America/Montevideo` - America/Montevideo - `America/Montserrat` - America/Montserrat - `America/Nassau` - America/Nassau - `America/New_York` - America/New_York - `America/Nome` - America/Nome - `America/Noronha` - America/Noronha - `America/North_Dakota/Beulah` - America/North_Dakota/Beulah - `America/North_Dakota/Center` - America/North_Dakota/Center - `America/North_Dakota/New_Salem` - America/North_Dakota/New_Salem - `America/Nuuk` - America/Nuuk - `America/Ojinaga` - America/Ojinaga - `America/Panama` - America/Panama - `America/Paramaribo` - America/Paramaribo - `America/Phoenix` - America/Phoenix - `America/Port-au-Prince` - America/Port-au-Prince - `America/Port_of_Spain` - America/Port_of_Spain - `America/Porto_Velho` - America/Porto_Velho - `America/Puerto_Rico` - America/Puerto_Rico - `America/Punta_Arenas` - America/Punta_Arenas - `America/Rankin_Inlet` - America/Rankin_Inlet - `America/Recife` - America/Recife - `America/Regina` - America/Regina - `America/Resolute` - America/Resolute - `America/Rio_Branco` - America/Rio_Branco - `America/Santarem` - America/Santarem - `America/Santiago` - America/Santiago - `America/Santo_Domingo` - America/Santo_Domingo - `America/Sao_Paulo` - America/Sao_Paulo - `America/Scoresbysund` - America/Scoresbysund - `America/Sitka` - America/Sitka - `America/St_Barthelemy` - America/St_Barthelemy - `America/St_Johns` - America/St_Johns - `America/St_Kitts` - America/St_Kitts - `America/St_Lucia` - America/St_Lucia - `America/St_Thomas` - America/St_Thomas - `America/St_Vincent` - America/St_Vincent - `America/Swift_Current` - America/Swift_Current - `America/Tegucigalpa` - America/Tegucigalpa - `America/Thule` - America/Thule - `America/Tijuana` - America/Tijuana - `America/Toronto` - America/Toronto - `America/Tortola` - America/Tortola - `America/Vancouver` - America/Vancouver - `America/Whitehorse` - America/Whitehorse - `America/Winnipeg` - America/Winnipeg - `America/Yakutat` - America/Yakutat - `Antarctica/Casey` - Antarctica/Casey - `Antarctica/Davis` - Antarctica/Davis - `Antarctica/DumontDUrville` - Antarctica/DumontDUrville - `Antarctica/Macquarie` - Antarctica/Macquarie - `Antarctica/Mawson` - Antarctica/Mawson - `Antarctica/McMurdo` - Antarctica/McMurdo - `Antarctica/Palmer` - Antarctica/Palmer - `Antarctica/Rothera` - Antarctica/Rothera - `Antarctica/Syowa` - Antarctica/Syowa - `Antarctica/Troll` - Antarctica/Troll - `Antarctica/Vostok` - Antarctica/Vostok - `Arctic/Longyearbyen` - Arctic/Longyearbyen - `Asia/Aden` - Asia/Aden - `Asia/Almaty` - Asia/Almaty - `Asia/Amman` - Asia/Amman - `Asia/Anadyr` - Asia/Anadyr - `Asia/Aqtau` - Asia/Aqtau - `Asia/Aqtobe` - Asia/Aqtobe - `Asia/Ashgabat` - Asia/Ashgabat - `Asia/Atyrau` - Asia/Atyrau - `Asia/Baghdad` - Asia/Baghdad - `Asia/Bahrain` - Asia/Bahrain - `Asia/Baku` - Asia/Baku - `Asia/Bangkok` - Asia/Bangkok - `Asia/Barnaul` - Asia/Barnaul - `Asia/Beirut` - Asia/Beirut - `Asia/Bishkek` - Asia/Bishkek - `Asia/Brunei` - Asia/Brunei - `Asia/Chita` - Asia/Chita - `Asia/Choibalsan` - Asia/Choibalsan - `Asia/Colombo` - Asia/Colombo - `Asia/Damascus` - Asia/Damascus - `Asia/Dhaka` - Asia/Dhaka - `Asia/Dili` - Asia/Dili - `Asia/Dubai` - Asia/Dubai - `Asia/Dushanbe` - Asia/Dushanbe - `Asia/Famagusta` - Asia/Famagusta - `Asia/Gaza` - Asia/Gaza - `Asia/Hebron` - Asia/Hebron - `Asia/Ho_Chi_Minh` - Asia/Ho_Chi_Minh - `Asia/Hong_Kong` - Asia/Hong_Kong - `Asia/Hovd` - Asia/Hovd - `Asia/Irkutsk` - Asia/Irkutsk - `Asia/Jakarta` - Asia/Jakarta - `Asia/Jayapura` - Asia/Jayapura - `Asia/Jerusalem` - Asia/Jerusalem - `Asia/Kabul` - Asia/Kabul - `Asia/Kamchatka` - Asia/Kamchatka - `Asia/Karachi` - Asia/Karachi - `Asia/Kathmandu` - Asia/Kathmandu - `Asia/Khandyga` - Asia/Khandyga - `Asia/Kolkata` - Asia/Kolkata - `Asia/Krasnoyarsk` - Asia/Krasnoyarsk - `Asia/Kuala_Lumpur` - Asia/Kuala_Lumpur - `Asia/Kuching` - Asia/Kuching - `Asia/Kuwait` - Asia/Kuwait - `Asia/Macau` - Asia/Macau - `Asia/Magadan` - Asia/Magadan - `Asia/Makassar` - Asia/Makassar - `Asia/Manila` - Asia/Manila - `Asia/Muscat` - Asia/Muscat - `Asia/Nicosia` - Asia/Nicosia - `Asia/Novokuznetsk` - Asia/Novokuznetsk - `Asia/Novosibirsk` - Asia/Novosibirsk - `Asia/Omsk` - Asia/Omsk - `Asia/Oral` - Asia/Oral - `Asia/Phnom_Penh` - Asia/Phnom_Penh - `Asia/Pontianak` - Asia/Pontianak - `Asia/Pyongyang` - Asia/Pyongyang - `Asia/Qatar` - Asia/Qatar - `Asia/Qostanay` - Asia/Qostanay - `Asia/Qyzylorda` - Asia/Qyzylorda - `Asia/Riyadh` - Asia/Riyadh - `Asia/Sakhalin` - Asia/Sakhalin - `Asia/Samarkand` - Asia/Samarkand - `Asia/Seoul` - Asia/Seoul - `Asia/Shanghai` - Asia/Shanghai - `Asia/Singapore` - Asia/Singapore - `Asia/Srednekolymsk` - Asia/Srednekolymsk - `Asia/Taipei` - Asia/Taipei - `Asia/Tashkent` - Asia/Tashkent - `Asia/Tbilisi` - Asia/Tbilisi - `Asia/Tehran` - Asia/Tehran - `Asia/Thimphu` - Asia/Thimphu - `Asia/Tokyo` - Asia/Tokyo - `Asia/Tomsk` - Asia/Tomsk - `Asia/Ulaanbaatar` - Asia/Ulaanbaatar - `Asia/Urumqi` - Asia/Urumqi - `Asia/Ust-Nera` - Asia/Ust-Nera - `Asia/Vientiane` - Asia/Vientiane - `Asia/Vladivostok` - Asia/Vladivostok - `Asia/Yakutsk` - Asia/Yakutsk - `Asia/Yangon` - Asia/Yangon - `Asia/Yekaterinburg` - Asia/Yekaterinburg - `Asia/Yerevan` - Asia/Yerevan - `Atlantic/Azores` - Atlantic/Azores - `Atlantic/Bermuda` - Atlantic/Bermuda - `Atlantic/Canary` - Atlantic/Canary - `Atlantic/Cape_Verde` - Atlantic/Cape_Verde - `Atlantic/Faroe` - Atlantic/Faroe - `Atlantic/Madeira` - Atlantic/Madeira - `Atlantic/Reykjavik` - Atlantic/Reykjavik - `Atlantic/South_Georgia` - Atlantic/South_Georgia - `Atlantic/St_Helena` - Atlantic/St_Helena - `Atlantic/Stanley` - Atlantic/Stanley - `Australia/Adelaide` - Australia/Adelaide - `Australia/Brisbane` - Australia/Brisbane - `Australia/Broken_Hill` - Australia/Broken_Hill - `Australia/Darwin` - Australia/Darwin - `Australia/Eucla` - Australia/Eucla - `Australia/Hobart` - Australia/Hobart - `Australia/Lindeman` - Australia/Lindeman - `Australia/Lord_Howe` - Australia/Lord_Howe - `Australia/Melbourne` - Australia/Melbourne - `Australia/Perth` - Australia/Perth - `Australia/Sydney` - Australia/Sydney - `Canada/Atlantic` - Canada/Atlantic - `Canada/Central` - Canada/Central - `Canada/Eastern` - Canada/Eastern - `Canada/Mountain` - Canada/Mountain - `Canada/Newfoundland` - Canada/Newfoundland - `Canada/Pacific` - Canada/Pacific - `Europe/Amsterdam` - Europe/Amsterdam - `Europe/Andorra` - Europe/Andorra - `Europe/Astrakhan` - Europe/Astrakhan - `Europe/Athens` - Europe/Athens - `Europe/Belgrade` - Europe/Belgrade - `Europe/Berlin` - Europe/Berlin - `Europe/Bratislava` - Europe/Bratislava - `Europe/Brussels` - Europe/Brussels - `Europe/Bucharest` - Europe/Bucharest - `Europe/Budapest` - Europe/Budapest - `Europe/Busingen` - Europe/Busingen - `Europe/Chisinau` - Europe/Chisinau - `Europe/Copenhagen` - Europe/Copenhagen - `Europe/Dublin` - Europe/Dublin - `Europe/Gibraltar` - Europe/Gibraltar - `Europe/Guernsey` - Europe/Guernsey - `Europe/Helsinki` - Europe/Helsinki - `Europe/Isle_of_Man` - Europe/Isle_of_Man - `Europe/Istanbul` - Europe/Istanbul - `Europe/Jersey` - Europe/Jersey - `Europe/Kaliningrad` - Europe/Kaliningrad - `Europe/Kirov` - Europe/Kirov - `Europe/Kyiv` - Europe/Kyiv - `Europe/Lisbon` - Europe/Lisbon - `Europe/Ljubljana` - Europe/Ljubljana - `Europe/London` - Europe/London - `Europe/Luxembourg` - Europe/Luxembourg - `Europe/Madrid` - Europe/Madrid - `Europe/Malta` - Europe/Malta - `Europe/Mariehamn` - Europe/Mariehamn - `Europe/Minsk` - Europe/Minsk - `Europe/Monaco` - Europe/Monaco - `Europe/Moscow` - Europe/Moscow - `Europe/Oslo` - Europe/Oslo - `Europe/Paris` - Europe/Paris - `Europe/Podgorica` - Europe/Podgorica - `Europe/Prague` - Europe/Prague - `Europe/Riga` - Europe/Riga - `Europe/Rome` - Europe/Rome - `Europe/Samara` - Europe/Samara - `Europe/San_Marino` - Europe/San_Marino - `Europe/Sarajevo` - Europe/Sarajevo - `Europe/Saratov` - Europe/Saratov - `Europe/Simferopol` - Europe/Simferopol - `Europe/Skopje` - Europe/Skopje - `Europe/Sofia` - Europe/Sofia - `Europe/Stockholm` - Europe/Stockholm - `Europe/Tallinn` - Europe/Tallinn - `Europe/Tirane` - Europe/Tirane - `Europe/Ulyanovsk` - Europe/Ulyanovsk - `Europe/Vaduz` - Europe/Vaduz - `Europe/Vatican` - Europe/Vatican - `Europe/Vienna` - Europe/Vienna - `Europe/Vilnius` - Europe/Vilnius - `Europe/Volgograd` - Europe/Volgograd - `Europe/Warsaw` - Europe/Warsaw - `Europe/Zagreb` - Europe/Zagreb - `Europe/Zurich` - Europe/Zurich - `GMT` - GMT - `Indian/Antananarivo` - Indian/Antananarivo - `Indian/Chagos` - Indian/Chagos - `Indian/Christmas` - Indian/Christmas - `Indian/Cocos` - Indian/Cocos - `Indian/Comoro` - Indian/Comoro - `Indian/Kerguelen` - Indian/Kerguelen - `Indian/Mahe` - Indian/Mahe - `Indian/Maldives` - Indian/Maldives - `Indian/Mauritius` - Indian/Mauritius - `Indian/Mayotte` - Indian/Mayotte - `Indian/Reunion` - Indian/Reunion - `Pacific/Apia` - Pacific/Apia - `Pacific/Auckland` - Pacific/Auckland - `Pacific/Bougainville` - Pacific/Bougainville - `Pacific/Chatham` - Pacific/Chatham - `Pacific/Chuuk` - Pacific/Chuuk - `Pacific/Easter` - Pacific/Easter - `Pacific/Efate` - Pacific/Efate - `Pacific/Fakaofo` - Pacific/Fakaofo - `Pacific/Fiji` - Pacific/Fiji - `Pacific/Funafuti` - Pacific/Funafuti - `Pacific/Galapagos` - Pacific/Galapagos - `Pacific/Gambier` - Pacific/Gambier - `Pacific/Guadalcanal` - Pacific/Guadalcanal - `Pacific/Guam` - Pacific/Guam - `Pacific/Honolulu` - Pacific/Honolulu - `Pacific/Kanton` - Pacific/Kanton - `Pacific/Kiritimati` - Pacific/Kiritimati - `Pacific/Kosrae` - Pacific/Kosrae - `Pacific/Kwajalein` - Pacific/Kwajalein - `Pacific/Majuro` - Pacific/Majuro - `Pacific/Marquesas` - Pacific/Marquesas - `Pacific/Midway` - Pacific/Midway - `Pacific/Nauru` - Pacific/Nauru - `Pacific/Niue` - Pacific/Niue - `Pacific/Norfolk` - Pacific/Norfolk - `Pacific/Noumea` - Pacific/Noumea - `Pacific/Pago_Pago` - Pacific/Pago_Pago - `Pacific/Palau` - Pacific/Palau - `Pacific/Pitcairn` - Pacific/Pitcairn - `Pacific/Pohnpei` - Pacific/Pohnpei - `Pacific/Port_Moresby` - Pacific/Port_Moresby - `Pacific/Rarotonga` - Pacific/Rarotonga - `Pacific/Saipan` - Pacific/Saipan - `Pacific/Tahiti` - Pacific/Tahiti - `Pacific/Tarawa` - Pacific/Tarawa - `Pacific/Tongatapu` - Pacific/Tongatapu - `Pacific/Wake` - Pacific/Wake - `Pacific/Wallis` - Pacific/Wallis - `US/Alaska` - US/Alaska - `US/Arizona` - US/Arizona - `US/Central` - US/Central - `US/Eastern` - US/Eastern - `US/Hawaii` - US/Hawaii - `US/Mountain` - US/Mountain - `US/Pacific` - US/Pacific - `UTC` - UTC One of `Africa/Abidjan`, `Africa/Accra`, `Africa/Addis_Ababa`, `Africa/Algiers`, `Africa/Asmara`, `Africa/Bamako`, `Africa/Bangui`, `Africa/Banjul`, `Africa/Bissau`, `Africa/Blantyre`, `Africa/Brazzaville`, `Africa/Bujumbura`, `Africa/Cairo`, `Africa/Casablanca`, `Africa/Ceuta`, `Africa/Conakry`, `Africa/Dakar`, `Africa/Dar_es_Salaam`, `Africa/Djibouti`, `Africa/Douala`, `Africa/El_Aaiun`, `Africa/Freetown`, `Africa/Gaborone`, `Africa/Harare`, `Africa/Johannesburg`, `Africa/Juba`, `Africa/Kampala`, `Africa/Khartoum`, `Africa/Kigali`, `Africa/Kinshasa`, `Africa/Lagos`, `Africa/Libreville`, `Africa/Lome`, `Africa/Luanda`, `Africa/Lubumbashi`, `Africa/Lusaka`, `Africa/Malabo`, `Africa/Maputo`, `Africa/Maseru`, `Africa/Mbabane`, `Africa/Mogadishu`, `Africa/Monrovia`, `Africa/Nairobi`, `Africa/Ndjamena`, `Africa/Niamey`, `Africa/Nouakchott`, `Africa/Ouagadougou`, `Africa/Porto-Novo`, `Africa/Sao_Tome`, `Africa/Tripoli`, `Africa/Tunis`, `Africa/Windhoek`, `America/Adak`, `America/Anchorage`, `America/Anguilla`, `America/Antigua`, `America/Araguaina`, `America/Argentina/Buenos_Aires`, `America/Argentina/Catamarca`, `America/Argentina/Cordoba`, `America/Argentina/Jujuy`, `America/Argentina/La_Rioja`, `America/Argentina/Mendoza`, `America/Argentina/Rio_Gallegos`, `America/Argentina/Salta`, `America/Argentina/San_Juan`, `America/Argentina/San_Luis`, `America/Argentina/Tucuman`, `America/Argentina/Ushuaia`, `America/Aruba`, `America/Asuncion`, `America/Atikokan`, `America/Bahia`, `America/Bahia_Banderas`, `America/Barbados`, `America/Belem`, `America/Belize`, `America/Blanc-Sablon`, `America/Boa_Vista`, `America/Bogota`, `America/Boise`, `America/Cambridge_Bay`, `America/Campo_Grande`, `America/Cancun`, `America/Caracas`, `America/Cayenne`, `America/Cayman`, `America/Chicago`, `America/Chihuahua`, `America/Ciudad_Juarez`, `America/Costa_Rica`, `America/Creston`, `America/Cuiaba`, `America/Curacao`, `America/Danmarkshavn`, `America/Dawson`, `America/Dawson_Creek`, `America/Denver`, `America/Detroit`, `America/Dominica`, `America/Edmonton`, `America/Eirunepe`, `America/El_Salvador`, `America/Fort_Nelson`, `America/Fortaleza`, `America/Glace_Bay`, `America/Goose_Bay`, `America/Grand_Turk`, `America/Grenada`, `America/Guadeloupe`, `America/Guatemala`, `America/Guayaquil`, `America/Guyana`, `America/Halifax`, `America/Havana`, `America/Hermosillo`, `America/Indiana/Indianapolis`, `America/Indiana/Knox`, `America/Indiana/Marengo`, `America/Indiana/Petersburg`, `America/Indiana/Tell_City`, `America/Indiana/Vevay`, `America/Indiana/Vincennes`, `America/Indiana/Winamac`, `America/Inuvik`, `America/Iqaluit`, `America/Jamaica`, `America/Juneau`, `America/Kentucky/Louisville`, `America/Kentucky/Monticello`, `America/Kralendijk`, `America/La_Paz`, `America/Lima`, `America/Los_Angeles`, `America/Lower_Princes`, `America/Maceio`, `America/Managua`, `America/Manaus`, `America/Marigot`, `America/Martinique`, `America/Matamoros`, `America/Mazatlan`, `America/Menominee`, `America/Merida`, `America/Metlakatla`, `America/Mexico_City`, `America/Miquelon`, `America/Moncton`, `America/Monterrey`, `America/Montevideo`, `America/Montserrat`, `America/Nassau`, `America/New_York`, `America/Nome`, `America/Noronha`, `America/North_Dakota/Beulah`, `America/North_Dakota/Center`, `America/North_Dakota/New_Salem`, `America/Nuuk`, `America/Ojinaga`, `America/Panama`, `America/Paramaribo`, `America/Phoenix`, `America/Port-au-Prince`, `America/Port_of_Spain`, `America/Porto_Velho`, `America/Puerto_Rico`, `America/Punta_Arenas`, `America/Rankin_Inlet`, `America/Recife`, `America/Regina`, `America/Resolute`, `America/Rio_Branco`, `America/Santarem`, `America/Santiago`, `America/Santo_Domingo`, `America/Sao_Paulo`, `America/Scoresbysund`, `America/Sitka`, `America/St_Barthelemy`, `America/St_Johns`, `America/St_Kitts`, `America/St_Lucia`, `America/St_Thomas`, `America/St_Vincent`, `America/Swift_Current`, `America/Tegucigalpa`, `America/Thule`, `America/Tijuana`, `America/Toronto`, `America/Tortola`, `America/Vancouver`, `America/Whitehorse`, `America/Winnipeg`, `America/Yakutat`, `Antarctica/Casey`, `Antarctica/Davis`, `Antarctica/DumontDUrville`, `Antarctica/Macquarie`, `Antarctica/Mawson`, `Antarctica/McMurdo`, `Antarctica/Palmer`, `Antarctica/Rothera`, `Antarctica/Syowa`, `Antarctica/Troll`, `Antarctica/Vostok`, `Arctic/Longyearbyen`, `Asia/Aden`, `Asia/Almaty`, `Asia/Amman`, `Asia/Anadyr`, `Asia/Aqtau`, `Asia/Aqtobe`, `Asia/Ashgabat`, `Asia/Atyrau`, `Asia/Baghdad`, `Asia/Bahrain`, `Asia/Baku`, `Asia/Bangkok`, `Asia/Barnaul`, `Asia/Beirut`, `Asia/Bishkek`, `Asia/Brunei`, `Asia/Chita`, `Asia/Choibalsan`, `Asia/Colombo`, `Asia/Damascus`, `Asia/Dhaka`, `Asia/Dili`, `Asia/Dubai`, `Asia/Dushanbe`, `Asia/Famagusta`, `Asia/Gaza`, `Asia/Hebron`, `Asia/Ho_Chi_Minh`, `Asia/Hong_Kong`, `Asia/Hovd`, `Asia/Irkutsk`, `Asia/Jakarta`, `Asia/Jayapura`, `Asia/Jerusalem`, `Asia/Kabul`, `Asia/Kamchatka`, `Asia/Karachi`, `Asia/Kathmandu`, `Asia/Khandyga`, `Asia/Kolkata`, `Asia/Krasnoyarsk`, `Asia/Kuala_Lumpur`, `Asia/Kuching`, `Asia/Kuwait`, `Asia/Macau`, `Asia/Magadan`, `Asia/Makassar`, `Asia/Manila`, `Asia/Muscat`, `Asia/Nicosia`, `Asia/Novokuznetsk`, `Asia/Novosibirsk`, `Asia/Omsk`, `Asia/Oral`, `Asia/Phnom_Penh`, `Asia/Pontianak`, `Asia/Pyongyang`, `Asia/Qatar`, `Asia/Qostanay`, `Asia/Qyzylorda`, `Asia/Riyadh`, `Asia/Sakhalin`, `Asia/Samarkand`, `Asia/Seoul`, `Asia/Shanghai`, `Asia/Singapore`, `Asia/Srednekolymsk`, `Asia/Taipei`, `Asia/Tashkent`, `Asia/Tbilisi`, `Asia/Tehran`, `Asia/Thimphu`, `Asia/Tokyo`, `Asia/Tomsk`, `Asia/Ulaanbaatar`, `Asia/Urumqi`, `Asia/Ust-Nera`, `Asia/Vientiane`, `Asia/Vladivostok`, `Asia/Yakutsk`, `Asia/Yangon`, `Asia/Yekaterinburg`, `Asia/Yerevan`, `Atlantic/Azores`, `Atlantic/Bermuda`, `Atlantic/Canary`, `Atlantic/Cape_Verde`, `Atlantic/Faroe`, `Atlantic/Madeira`, `Atlantic/Reykjavik`, `Atlantic/South_Georgia`, `Atlantic/St_Helena`, `Atlantic/Stanley`, `Australia/Adelaide`, `Australia/Brisbane`, `Australia/Broken_Hill`, `Australia/Darwin`, `Australia/Eucla`, `Australia/Hobart`, `Australia/Lindeman`, `Australia/Lord_Howe`, `Australia/Melbourne`, `Australia/Perth`, `Australia/Sydney`, `Canada/Atlantic`, `Canada/Central`, `Canada/Eastern`, `Canada/Mountain`, `Canada/Newfoundland`, `Canada/Pacific`, `Europe/Amsterdam`, `Europe/Andorra`, `Europe/Astrakhan`, `Europe/Athens`, `Europe/Belgrade`, `Europe/Berlin`, `Europe/Bratislava`, `Europe/Brussels`, `Europe/Bucharest`, `Europe/Budapest`, `Europe/Busingen`, `Europe/Chisinau`, `Europe/Copenhagen`, `Europe/Dublin`, `Europe/Gibraltar`, `Europe/Guernsey`, `Europe/Helsinki`, `Europe/Isle_of_Man`, `Europe/Istanbul`, `Europe/Jersey`, `Europe/Kaliningrad`, `Europe/Kirov`, `Europe/Kyiv`, `Europe/Lisbon`, `Europe/Ljubljana`, `Europe/London`, `Europe/Luxembourg`, `Europe/Madrid`, `Europe/Malta`, `Europe/Mariehamn`, `Europe/Minsk`, `Europe/Monaco`, `Europe/Moscow`, `Europe/Oslo`, `Europe/Paris`, `Europe/Podgorica`, `Europe/Prague`, `Europe/Riga`, `Europe/Rome`, `Europe/Samara`, `Europe/San_Marino`, `Europe/Sarajevo`, `Europe/Saratov`, `Europe/Simferopol`, `Europe/Skopje`, `Europe/Sofia`, `Europe/Stockholm`, `Europe/Tallinn`, `Europe/Tirane`, `Europe/Ulyanovsk`, `Europe/Vaduz`, `Europe/Vatican`, `Europe/Vienna`, `Europe/Vilnius`, `Europe/Volgograd`, `Europe/Warsaw`, `Europe/Zagreb`, `Europe/Zurich`, `GMT`, `Indian/Antananarivo`, `Indian/Chagos`, `Indian/Christmas`, `Indian/Cocos`, `Indian/Comoro`, `Indian/Kerguelen`, `Indian/Mahe`, `Indian/Maldives`, `Indian/Mauritius`, `Indian/Mayotte`, `Indian/Reunion`, `Pacific/Apia`, `Pacific/Auckland`, `Pacific/Bougainville`, `Pacific/Chatham`, `Pacific/Chuuk`, `Pacific/Easter`, `Pacific/Efate`, `Pacific/Fakaofo`, `Pacific/Fiji`, `Pacific/Funafuti`, `Pacific/Galapagos`, `Pacific/Gambier`, `Pacific/Guadalcanal`, `Pacific/Guam`, `Pacific/Honolulu`, `Pacific/Kanton`, `Pacific/Kiritimati`, `Pacific/Kosrae`, `Pacific/Kwajalein`, `Pacific/Majuro`, `Pacific/Marquesas`, `Pacific/Midway`, `Pacific/Nauru`, `Pacific/Niue`, `Pacific/Norfolk`, `Pacific/Noumea`, `Pacific/Pago_Pago`, `Pacific/Palau`, `Pacific/Pitcairn`, `Pacific/Pohnpei`, `Pacific/Port_Moresby`, `Pacific/Rarotonga`, `Pacific/Saipan`, `Pacific/Tahiti`, `Pacific/Tarawa`, `Pacific/Tongatapu`, `Pacific/Wake`, `Pacific/Wallis`, `US/Alaska`, `US/Arizona`, `US/Central`, `US/Eastern`, `US/Hawaii`, `US/Mountain`, `US/Pacific`, `UTC`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archive_in`, `archived_at`, `close_in`, `cover_image`, `cover_image_url`, `created_at`, `created_by_id`, `cycle_view`, `default_assignee_id`, `default_state_id`, `description`, `emoji`, `estimate_id`, `external_id`, `external_source`, `guest_view_all_features`, `icon_prop`, `id`, `identifier`, `intake_view`, `is_issue_type_enabled`, `is_time_tracking_enabled`, `issue_views_view`, `logo_props`, `module_view`, `name`, `network`, `page_view`, `priority`, `project_lead_id`, `start_date`, `state_id`, `target_date`, `timezone`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `default_assignee`, `project_lead`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    v1_icon_prop: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Icon prop.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'workspace_slug',
              'name',
              'description',
              'project_lead_id',
              'default_assignee_id',
              'identifier',
              'v1_icon_prop',
              'emoji',
              'cover_image',
              'module_view',
              'cycle_view',
              'issue_views_view',
              'page_view',
              'intake_view',
              'guest_view_all_features',
              'archive_in',
              'close_in',
              'timezone',
              'external_source',
              'external_id',
              'is_issue_type_enabled',
              'is_time_tracking_enabled',
            ]
          : [
              'workspace_slug',
              'identifier',
              'name',
              'archive_in',
              'close_in',
              'cover_image',
              'cycle_view',
              'default_assignee_id',
              'default_state_id',
              'description',
              'emoji',
              'estimate_id',
              'external_id',
              'external_source',
              'guest_view_all_features',
              'icon_prop',
              'intake_view',
              'is_issue_type_enabled',
              'is_time_tracking_enabled',
              'issue_views_view',
              'logo_props',
              'module_view',
              'network',
              'page_view',
              'priority',
              'project_lead_id',
              'start_date',
              'state_id',
              'target_date',
              'timezone',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'identifier',
          'name',
          'archive_in',
          'close_in',
          'cover_image',
          'cycle_view',
          'default_assignee_id',
          'default_state_id',
          'description',
          'emoji',
          'estimate_id',
          'external_id',
          'external_source',
          'guest_view_all_features',
          'icon_prop',
          'intake_view',
          'is_issue_type_enabled',
          'is_time_tracking_enabled',
          'issue_views_view',
          'logo_props',
          'module_view',
          'network',
          'page_view',
          'priority',
          'project_lead_id',
          'start_date',
          'state_id',
          'target_date',
          'timezone',
          'fields',
          'expand',
          'v1_icon_prop',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              description: { key: 'description', type: 'string', required: false },
              project_lead: { key: 'project_lead_id', type: 'string', required: false },
              default_assignee: { key: 'default_assignee_id', type: 'string', required: false },
              identifier: { key: 'identifier', type: 'string', required: true },
              icon_prop: { key: 'v1_icon_prop', type: 'object', required: false },
              emoji: { key: 'emoji', type: 'string', required: false },
              cover_image: { key: 'cover_image', type: 'string', required: false },
              module_view: { key: 'module_view', type: 'boolean', required: false },
              cycle_view: { key: 'cycle_view', type: 'boolean', required: false },
              issue_views_view: { key: 'issue_views_view', type: 'boolean', required: false },
              page_view: { key: 'page_view', type: 'boolean', required: false },
              intake_view: { key: 'intake_view', type: 'boolean', required: false },
              guest_view_all_features: {
                key: 'guest_view_all_features',
                type: 'boolean',
                required: false,
              },
              archive_in: { key: 'archive_in', type: 'integer', required: false },
              close_in: { key: 'close_in', type: 'integer', required: false },
              timezone: { key: 'timezone', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              is_issue_type_enabled: {
                key: 'is_issue_type_enabled',
                type: 'boolean',
                required: false,
              },
              is_time_tracking_enabled: {
                key: 'is_time_tracking_enabled',
                type: 'boolean',
                required: false,
              },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              identifier: { key: 'identifier', type: 'string', required: true },
              name: { key: 'name', type: 'string', required: true },
              archive_in: { key: 'archive_in', type: 'integer', required: false },
              close_in: { key: 'close_in', type: 'integer', required: false },
              cover_image: { key: 'cover_image', type: 'string', required: false },
              cycle_view: { key: 'cycle_view', type: 'boolean', required: false },
              default_assignee_id: { key: 'default_assignee_id', type: 'string', required: false },
              default_state_id: { key: 'default_state_id', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              emoji: { key: 'emoji', type: 'string', required: false },
              estimate_id: { key: 'estimate_id', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              guest_view_all_features: {
                key: 'guest_view_all_features',
                type: 'boolean',
                required: false,
              },
              icon_prop: { key: 'icon_prop', type: 'string', required: false },
              intake_view: { key: 'intake_view', type: 'boolean', required: false },
              is_issue_type_enabled: {
                key: 'is_issue_type_enabled',
                type: 'boolean',
                required: false,
              },
              is_time_tracking_enabled: {
                key: 'is_time_tracking_enabled',
                type: 'boolean',
                required: false,
              },
              issue_views_view: { key: 'issue_views_view', type: 'boolean', required: false },
              logo_props: { key: 'logo_props', type: 'string', required: false },
              module_view: { key: 'module_view', type: 'boolean', required: false },
              network: { key: 'network', type: 'string', required: false },
              page_view: { key: 'page_view', type: 'boolean', required: false },
              priority: { key: 'priority', type: 'string', required: false },
              project_lead_id: { key: 'project_lead_id', type: 'string', required: false },
              start_date: { key: 'start_date', type: 'string', required: false },
              state_id: { key: 'state_id', type: 'string', required: false },
              target_date: { key: 'target_date', type: 'string', required: false },
              timezone: { key: 'timezone', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Projects80208cSchema)
      : planeObjectResponse(response, planeV2Projects80208cSchema),
  outputs: { result: PLANEV2PROJECTS80208C_OUTPUT },
}
