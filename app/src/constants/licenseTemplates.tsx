// app/src/constants/licenseTemplates.ts
import type { LicenseTerms } from "../lib/licensing";

export const DEFAULT_LICENSE_TERMS: LicenseTerms = {
  purpose: "Advertising - Social & Web",
  term_months: 12,
  territory: "Worldwide",
  media: ["Web", "Social", "Email"],
  exclusivity: "non-exclusive",
  start_date: undefined,
  deliverables: "Right to use artwork image in campaign creatives.",
  credit_required: true,
  usage_notes: "No logo lockups; link back to creator profile when possible.",
  fee: { amount: 1500, currency: "USD" },
};
