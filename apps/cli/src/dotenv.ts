import * as fs from "node:fs";
import * as path from "node:path";


export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted && value.length >= 2) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) result[key] = value;
  }

  return result;
}

/**
 * Carga un .env en el entorno del proceso. Las variables YA definidas ganan: lo que se
 * exporta en la shell debe poder sobreescribir al archivo, no al revés. Si no existe,
 * no hace nada: el archivo es opcional.
 */
export function loadDotEnv(
  filePath: string = path.resolve(process.cwd(), ".env"),
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseEnvFile(content);

  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}