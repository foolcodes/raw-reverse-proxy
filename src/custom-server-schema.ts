import z from "zod";
export const workerProcessSchema = z.object({
  type: z.enum(["HTTP"]),
  headers: z.any(),
  body: z.any(),
  path: z.string(),
});

export type WorkerProcessType = z.infer<typeof workerProcessSchema>;
