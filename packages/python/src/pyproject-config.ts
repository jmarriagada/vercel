import fs from 'fs';
import { join } from 'path';

const CONFIG_NAME_RE = /^[A-Za-z]([A-Za-z0-9_-]*[A-Za-z0-9])?$/;
const MODULE_ATTR_RE =
  /^([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*):([A-Za-z_][\w]*)$/;

export interface ModuleAttrEntrypoint {
  moduleName: string;
  variableName: string;
  filePath: string;
}

export function isValidConfigName(value: string): boolean {
  return CONFIG_NAME_RE.test(value);
}

export function parseModuleAttrEntrypoint(
  value: string
): ModuleAttrEntrypoint | null {
  const match = MODULE_ATTR_RE.exec(value);
  if (!match) {
    return null;
  }

  return {
    moduleName: match[1],
    variableName: match[2],
    filePath: `${match[1].replace(/\./g, '/')}.py`,
  };
}

export async function resolveExistingEntrypoint(
  workPath: string,
  filePath: string
): Promise<string | null> {
  const candidates = [filePath, filePath.replace(/\.py$/i, '/__init__.py')];
  for (const candidate of candidates) {
    try {
      const stat = await fs.promises.stat(join(workPath, candidate));
      if (stat.isFile()) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

export function safePathSegment(value: string): string {
  return [...value]
    .map(char => {
      if (char === '_') {
        return '__';
      }
      return /[A-Za-z0-9-]/.test(char)
        ? char
        : `_${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}
