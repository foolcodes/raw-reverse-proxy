import cluster, { Worker } from "node:cluster";
import { mainConfigSchema, type SchemaConfig } from "./schema-config.js";
import http from "node:http";
import { workerProcessSchema } from "./custom-server-schema.js";
import type { WorkerProcessType } from "./custom-server-schema.js";
import { URL } from "node:url";

interface configParams {
  port: number;
  workers: number;
  config: SchemaConfig;
}

interface PendingRequest {
  res: http.ServerResponse;
  timeoutId: NodeJS.Timeout;
}

let upstreamIdx = 0; // keeping it in the memory to do round robin
let workerProcessIdx = 0;

export async function createCustomServer(config: configParams) {
  const { workers } = config; // extracting the no. of workers the user has decided to spun up.

  const POOL: Worker[] = []; // a constant array to stack worker processes
  const pendingRequests = new Map<string, PendingRequest>(); // a state to handle multiple requests coming rapidly.

  /* if its the primary cluster i.e., its the master node which \
    handles the core functionality and listens to the requests and then pass on the requests 
    to the worker processes*/
  if (cluster.isPrimary) {
    console.log("Master up");

    for (let i = 0; i < workers; i++) {
      const created_worker = cluster.fork({
        config: JSON.stringify(config.config),
      });

      POOL.push(created_worker); // spinning up a new worker process as per the workers mentioned.

      // message handler for each worker - which will send the response to the master node.
      created_worker.on("message", (workerResponse: string) => {
        try {
          const parsed = JSON.parse(workerResponse);
          const requestId = parsed.requestId;

          if (!requestId) {
            console.error("Response missing requestId");
            return;
          }

          const pending = pendingRequests.get(requestId);
          if (!pending) {
            console.error(`No pending request found for ID: ${requestId}`);
            return;
          }

          // Clear timeout
          clearTimeout(pending.timeoutId);
          pendingRequests.delete(requestId);

          // Send response
          if (parsed.error) {
            pending.res.writeHead(parsed.status || 500);
            pending.res.end(parsed.error);
          } else {
            pending.res.writeHead(parsed.status || 200, parsed.headers || {});
            pending.res.end(parsed.data);
          }
        } catch (err) {
          console.error("Error parsing worker response:", err);
        }
      });
    }

    const server = http.createServer(function (req, res) {
      // Round-robin or random selection
      const worker = POOL.at(workerProcessIdx); // getting the worker from the pool
      if (workers === workerProcessIdx) {
        // incrementing the workerProcessIdx to maintain the equal distribution of the requests
        upstreamIdx = 0;
      } else {
        upstreamIdx++;
      }

      if (!worker) {
        res.writeHead(500);
        res.end("No worker available");
        return;
      }

      const requestId = crypto.randomUUID(); // creating a unique requestId to match each request correctly
      const payload: WorkerProcessType = {
        // setting up the payload to send
        type: "HTTP",
        headers: req.headers,
        body: null,
        path: req.url as string,
      };

      // timeout to clean up the requests if the response dont come up within 30seconds
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        if (!res.headersSent) {
          res.writeHead(504);
          res.end("Gateway timeout");
        }
      }, 30000);

      // Store pending request
      pendingRequests.set(requestId, { res, timeoutId });

      // Send to worker
      worker.send(JSON.stringify({ ...payload, requestId }));
    });

    server.listen(config.port, () =>
      console.log(`Server listening on port ${config.port}`)
    );
  } else {
    /* This else executes when the master node passes on the request to one of the worker processes */
    const config = await mainConfigSchema.parseAsync(
      JSON.parse(`${process.env.config}`)
    );

    process.on("message", async (message) => {
      // as soon as we receive the message request we take the path and the headers and all other imp information to send to the upstream server.

      let requestId: string | undefined;

      try {
        const parsed = JSON.parse(message as string);
        requestId = parsed.requestId;

        const validatedMessage = await workerProcessSchema.parseAsync(parsed);
        const requestedPath = validatedMessage.path;

        console.log(`[Worker ${process.pid}] Processing: ${requestedPath}`);

        // Find matching rule
        const rule = config.server.rules.find((r) => {
          return requestedPath === r.path || requestedPath.startsWith(r.path);
        });

        if (!rule) {
          const reply = {
            requestId,
            status: 404,
            error: "No matching route found",
          };
          if (process.send) process.send(JSON.stringify(reply));
          return;
        }

        const upstreamId = rule.upstreams[upstreamIdx]; // doing round robin to choose a upstream server.
        if (rule.upstreams.length - 1 === upstreamIdx) {
          upstreamIdx = 0;
        } else {
          upstreamIdx++;
        }
        const upstreamServer = config.server.upstreams.find(
          (e) => e.id === upstreamId
        );

        if (!upstreamServer) {
          console.error(
            `[Worker ${process.pid}] No upstream found for ID: ${upstreamId}`
          );
          const reply = {
            requestId,
            status: 500,
            error: "No upstream server configured",
          };
          if (process.send) process.send(JSON.stringify(reply));
          return;
        }

        // Construct full upstream URL
        const fullUpstreamUrl = new URL(requestedPath, upstreamServer.url);

        console.log(
          `[Worker ${process.pid}] Proxying to: ${fullUpstreamUrl.href}`
        );

        const request = http.request(
          {
            hostname: fullUpstreamUrl.hostname,
            port:
              fullUpstreamUrl.port ||
              (fullUpstreamUrl.protocol === "https:" ? 443 : 80),
            path: fullUpstreamUrl.pathname + fullUpstreamUrl.search,
            method: validatedMessage.headers?.method || "GET",
            headers: {
              ...validatedMessage.headers,
              host: fullUpstreamUrl.hostname,
            },
          }, // getting the data from the upstream and then sending to back to the master node.
          (upstreamRes) => {
            let body = "";

            upstreamRes.on("data", (chunk) => {
              body += chunk;
            });

            upstreamRes.on("end", () => {
              const reply = {
                requestId,
                status: upstreamRes.statusCode,
                headers: upstreamRes.headers,
                data: body,
              };
              if (process.send) process.send(JSON.stringify(reply));
            });
          }
        );

        request.on("error", (err) => {
          console.error(`[Worker ${process.pid}] Upstream error:`, err);
          const reply = {
            requestId,
            status: 502,
            error: `Bad Gateway: ${err.message}`,
          };
          if (process.send) process.send(JSON.stringify(reply));
        });

        request.end();
      } catch (err) {
        console.error(`[Worker ${process.pid}] Error:`, err);
        const reply = {
          requestId,
          status: 500,
          error: err instanceof Error ? err.message : "Internal server error",
        };
        if (process.send) process.send(JSON.stringify(reply));
      }
    });
  }
}
