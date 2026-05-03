/**
 * Allowlist of IANA zones accepted for `business_profile.reporting_timezone`.
 *
 * MUST stay in sync with every `id` in:
 *   web-frontend/lib/reporting-timezones.ts → REPORTING_TIMEZONE_GROUPS
 *
 * @see https://www.iana.org/time-zones
 */
export const REPORTING_TIMEZONE_ALLOWLIST = [
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Argentina/Buenos_Aires',
  'America/Chicago',
  'America/Denver',
  'America/Juneau',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok',
  'Asia/Brunei',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Ho_Chi_Minh',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Jayapura',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Kuala_Lumpur',
  'Asia/Makassar',
  'Asia/Manila',
  'Asia/Phnom_Penh',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Yangon',
  'Atlantic/Reykjavik',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Darwin',
  'Australia/Perth',
  'Australia/Sydney',
  'Etc/UTC',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Pacific/Auckland',
  'Pacific/Honolulu',
] as const;

export type ReportingTimezoneAllowlist =
  (typeof REPORTING_TIMEZONE_ALLOWLIST)[number];

export function isAllowedReportingTimezone(
  z: string,
): z is ReportingTimezoneAllowlist {
  return (REPORTING_TIMEZONE_ALLOWLIST as readonly string[]).includes(z);
}
