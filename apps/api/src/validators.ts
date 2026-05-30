import { z } from 'zod';

export const authSchema = z.object({
  email: z.string().email().max(180).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(120),
});

export const registerSchema = authSchema.extend({
  name: z.string().min(2).max(80),
});

export const technologyCreateSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const technologyUpdateSchema = technologyCreateSchema.extend({
  id: z.string().min(1),
});

export const sessionCreateSchema = z.object({
  type: z.enum(['CODING', 'LEARNING']),
  title: z.string().min(2).max(120),
  notes: z.string().max(2000).optional(),
  minutes: z.number().int().min(5).max(1440),
  sessionDate: z.string().datetime().optional(),
  projectId: z.string().optional(),
  source: z.string().optional(),
  topic: z.string().optional(),
  focusScore: z.number().int().min(1).max(5).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  technologyIds: z.array(z.string()).default([]),
});

export const projectCreateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(2).max(1000),
  status: z.string().default('active'),
  repository: z.string().url().optional().or(z.literal('')),
  liveUrl: z.string().url().optional().or(z.literal('')),
  startedAt: z.string().datetime().optional(),
  technologyIds: z.array(z.string()).default([]),
});

export const projectUpdateSchema = projectCreateSchema.extend({
  id: z.string().min(1),
});

export const goalCreateSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'MILESTONE']),
  targetValue: z.number().min(1),
  currentValue: z.number().min(0).default(0),
  unit: z.string().min(1).max(40),
  dueDate: z.string().datetime().optional(),
  projectId: z.string().optional(),
});

export const goalUpdateSchema = goalCreateSchema.extend({
  id: z.string().min(1),
  status: z.enum(['ACTIVE', 'COMPLETED', 'PAUSED']).default('ACTIVE'),
});

export const sessionDeleteSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['CODING', 'LEARNING']),
});

export const sessionUpdateSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['CODING', 'LEARNING']),
  title: z.string().min(2).max(120),
  minutes: z.number().int().min(5).max(1440),
});
