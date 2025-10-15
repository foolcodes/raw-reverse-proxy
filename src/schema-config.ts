import { z } from "zod";

const upstreamSchema = z.object({
  id: z.string(),
  url: z.url(),
});

const rulesSchema = z.object({
  path: z.string(),
  upstreams: z.array(z.string()),
});

const serverSchema = z.object({
  listen: z.number(),
  workers: z.number().optional(),
  upstreams: z.array(upstreamSchema),
  rules: z.array(rulesSchema),
});

export const mainConfigSchema = z.object({
  server: serverSchema,
});

export type SchemaConfig = z.infer<typeof mainConfigSchema>;
