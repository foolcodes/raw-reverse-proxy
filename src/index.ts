import { program } from "commander";
import { parseYamlConfig, validateConfiguration } from "./config.js";
import os from "node:os";
import { createCustomServer } from "./server.js";

async function main() {
  program.option("--config <path>");
  program.parse();

  const options = program.opts();
  if (options && "config" in options) {
    const validatedConfig = await validateConfiguration(
      await parseYamlConfig(options.config)
    );
    await createCustomServer({
      port: validatedConfig.server.listen,
      workers: validatedConfig.server.workers ?? os.cpus.length,
      config: validatedConfig,
    });
  }
}

main();
