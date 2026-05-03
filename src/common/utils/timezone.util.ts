import { isAllowedReportingTimezone } from '../constants/reporting-timezones.constants';

/** Default when profile missing or stored value not on allowlist. */
export const DEFAULT_REPORTING_TIMEZONE = 'Asia/Jakarta';

export function resolveReportingTimezone(
  stored: string | null | undefined,
): string {
  const z = stored?.trim();
  if (z && isAllowedReportingTimezone(z)) return z;
  return DEFAULT_REPORTING_TIMEZONE;
}
