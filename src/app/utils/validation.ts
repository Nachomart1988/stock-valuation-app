import { z } from 'zod';

export const inputSchema = z.object({
  longTermGrowth: z.number().min(0).max(100),
  periodos: z.number().int().min(1).max(20),
  horizonte: z.number().int().min(1).max(50),
  margenSeguridad: z.number().min(0).max(100),
});

export type InputValues = z.infer<typeof inputSchema>;

export const validateInputs = (values: unknown): InputValues => {
  return inputSchema.parse(values);
};