// app/src/schemas/artwork.ts
import { z } from "zod";

/** Optional number that allows blank inputs ("") and casts strings to numbers */
const numOptional = (schema = z.number()) =>
  z.preprocess(
    (v) =>
      v === "" || v === null || typeof v === "undefined"
        ? undefined
        : typeof v === "string"
        ? Number(v)
        : v,
    schema.optional()
  );

/** Optional trimmed string with optional max length that treats "" as undefined */
const strOpt = (max?: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || typeof v === "undefined" ? undefined : v),
    (typeof max === "number" ? z.string().trim().max(max) : z.string().trim()).optional()
  );

/** Optional URL string that treats "" as undefined */
const urlOpt = z.preprocess(
  (v) => (v === "" || v === null || typeof v === "undefined" ? undefined : v),
  z.string().url().optional()
);

export const CreateArtworkSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  description: strOpt(5000),

  // Either file or imageUrl is acceptable (UI uses file)
  file: z
    .any()
    .optional()
    .refine((f) => !f || f instanceof File, "Invalid file"),
  imageUrl: urlOpt,

  medium: strOpt(200),
  year_created: strOpt(32),

  width: numOptional(z.number().positive({ message: "Must be > 0" })),
  height: numOptional(z.number().positive({ message: "Must be > 0" })),
  depth: numOptional(z.number().positive({ message: "Must be > 0" })),
  dim_unit: z.enum(["cm", "in", "px"]).optional(),

  edition_type: z.enum(["unique", "limited", "open"]).default("unique"),
  edition_size: numOptional(
    z.number().int("Must be an integer").positive("Must be > 0")
  ),

  // ✅ All refinements live inside preprocess's target schema
  royalty_bps: z.preprocess(
    (v) => (v === "" || v === null || typeof v === "undefined" ? 500 : Number(v)),
    z.number().int("Must be an integer").min(0).max(9500)
  ),

  status: z
    .enum(["draft", "active", "paused", "ended", "canceled"])
    .default("draft"),
  sale_type: z.enum(["fixed_price", "auction", "offer_only"]).optional(),
  list_price: numOptional(z.number().positive({ message: "Must be > 0" })),
  list_currency: strOpt(12),
  reserve_price: numOptional(z.number().positive({ message: "Must be > 0" })),
  min_offer: numOptional(z.number().positive({ message: "Must be > 0" })),

  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  is_nsfw: z.boolean().default(false),
});

export type CreateArtworkInput = z.infer<typeof CreateArtworkSchema>;
