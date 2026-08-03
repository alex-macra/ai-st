import { z } from 'zod';

const baseEventSchema = z.object({
  type: z.string(),
});

export const errorEventSchema = z.object({
  type: z.literal('error'),
  code: z.string().optional(),
  message: z.string(),
});

export const progressEventSchema = z.object({
  type: z.literal('progress'),
  pass: z.number().int().positive(),
  message: z.string(),
});

export const validationWarningsEventSchema = z.object({
  type: z.literal('validation_warnings'),
  warnings: z.array(z.unknown()),
});

export const referenceFlagsEventSchema = z.object({
  type: z.literal('reference_flags'),
  flags: z.array(z.unknown()),
});

export const doneEventSchema = z.object({
  type: z.literal('done'),
  findings: z.array(z.unknown()),
  narrative: z.string().optional(),
  structuredReport: z.unknown().optional(),
  referenceFlags: z.array(z.unknown()).optional(),
  validationWarnings: z.array(z.unknown()).optional(),
  modelVersion: z.string(),
});

export const sseEventSchema = z.discriminatedUnion('type', [
  errorEventSchema,
  progressEventSchema,
  validationWarningsEventSchema,
  referenceFlagsEventSchema,
  doneEventSchema,
]);

export type SseEvent = z.infer<typeof sseEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
export type ProgressEvent = z.infer<typeof progressEventSchema>;
export type ValidationWarningsEvent = z.infer<typeof validationWarningsEventSchema>;
export type ReferenceFlagsEvent = z.infer<typeof referenceFlagsEventSchema>;
export type DoneEvent = z.infer<typeof doneEventSchema>;

export function validateSseEvent(event: unknown): SseEvent {
  return sseEventSchema.parse(event);
}

export function validateErrorEvent(event: unknown): ErrorEvent {
  return errorEventSchema.parse(event);
}
