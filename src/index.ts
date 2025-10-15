import { program } from "commander";
import { parseYamlConfig, validateConfiguration } from "./config.js";
import os from "node:os";
import { createCustomServer } from "./server.js";

async function main() {
  program.option("--config <path>"); // getting the yaml file with path
  program.parse();

  const options = program.opts();
  if (options && "config" in options) {
    const validatedConfig = await validateConfiguration(
      await parseYamlConfig(options.config) // parsing the yaml file to JSON and validating to confirm that its in right format as we want.
    );
    await createCustomServer({
      // creating custom server - this is the main thing
      port: validatedConfig.server.listen,
      workers: validatedConfig.server.workers ?? os.cpus.length,
      config: validatedConfig,
    });
  }
}

main();
