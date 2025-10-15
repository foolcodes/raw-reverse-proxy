import cluster, { Worker } from "node:cluster";
import type { SchemaConfig } from "./schema-config.js";
import http from "node:http";
import type { WorkerProcessSchema } from "./custom-server-schema.js";

interface configParams {
  port: number;
  workers: number;
  config: SchemaConfig;
}

export async function createCustomServer(config: configParams) {
  const { workers } = config;

  if (cluster.isPrimary) {
    console.log("Master up");
    for (let i = 0; i < workers; i++) {
      cluster.fork({ config: JSON.stringify(config) });
      console.log("Worker up");
    }
    const server = http.createServer(function (req, res) {
      const index = Math.floor(Math.random() * workers);
      const worker: Worker = Object.values(!cluster.workers)[index];

      const payload: WorkerProcessSchema = {
        type: "HTTP",
        headers: req.headers,
        body: null,
        path: req.url as string,
      };

      worker.send(payload);
    });
    server.listen(config.port, () =>
      console.log(`Server listening on port ${config.port}`)
    );
  } else {
    const config = process.env.config;
    process.on("message", (message) => {
      console.log(message);
    });
  }
}
