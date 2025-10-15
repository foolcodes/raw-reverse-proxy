import z from "zod";

const workerProcessSchema = z.object({
  type: z.enum(["HTTP"]),
  headers: z.any(),
  body: z.any(),
  path: z.string(),
});

export type WorkerProcessSchema = z.infer<typeof workerProcessSchema>;
