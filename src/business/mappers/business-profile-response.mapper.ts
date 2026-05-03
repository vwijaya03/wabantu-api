import { resolveReportingTimezone } from '../../common/utils/timezone.util';
import { BusinessProfile } from '../../database/tenant/entities/business-profile.entity';

/** JSON shape returned by GET/PATCH `/business/profile` (camelCase). */
export type BusinessProfileResponse = {
  id: string;
  businessName: string;
  description: string | null;
  address: string | null;
  openingHours: string | null;
  productsServices: string | null;
  basePricing: string | null;
  deliveryArea: string | null;
  greetingTemplate: string | null;
  tone: 'friendly' | 'formal' | 'casual';
  aiEnabled: boolean;
  reportingTimezone: string;
};

/**
 * Plain DTO for HTTP responses so `reportingTimezone` is always a normalized
 * allowlist id (never lost to serialization edge cases).
 */
export function toBusinessProfileResponse(
  profile: BusinessProfile,
): BusinessProfileResponse {
  return {
    id: profile.id,
    businessName: profile.businessName,
    description: profile.description,
    address: profile.address,
    openingHours: profile.openingHours,
    productsServices: profile.productsServices,
    basePricing: profile.basePricing,
    deliveryArea: profile.deliveryArea,
    greetingTemplate: profile.greetingTemplate,
    tone: profile.tone,
    aiEnabled: profile.aiEnabled,
    reportingTimezone: resolveReportingTimezone(profile.reportingTimezone),
  };
}
