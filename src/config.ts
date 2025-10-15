import fs from "node:fs/promises";
import { parse } from "yaml";
import { mainConfigSchema } from "./schema-config.js";

export async function parseYamlConfig(filePath: string) {
  const fileContent = await fs.readFile(filePath, "utf8");
  const configParsed = parse(fileContent);
  return JSON.stringify(configParsed);
}

export async function validateConfiguration(config: string) {
  try {
    const validatedConfig = await mainConfigSchema.parseAsync(
      JSON.parse(config)
    );
    return validatedConfig;
  } catch (error) {
    console.log("Error validating the configuration");
    throw new Error("No valid configuration");
  }
}
