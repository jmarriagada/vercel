import fs from 'fs';
import { join } from 'path';
import { NowBuildError, readConfigFile, type Cron } from '@vercel/build-utils';
import {
  detectDynamicCrons,
  type DynamicCronEntry,
  type ServiceCronEntry,
} from './crons';
import {
  isValidConfigName,
  parseModuleAttrEntrypoint,
  resolveExistingEntrypoint,
  safePathSegment,
} from './pyproject-config';

interface RawCron {
  entrypoint?: unknown;
  schedule?: unknown;
}

interface Pyproject {
  tool?: {
    vercel?: {
      crons?: Record<string, RawCron>;
    };
  };
}

export interface PyprojectCron {
  name: string;
  entrypoint: string;
  moduleName: string;
  variableName: string;
  schedule?: string;
}

export interface ResolvedPyprojectCronGroup {
  name: string;
  entrypoint: string;
  moduleName: string;
  variableName: string;
  outputPath: string;
  routePrefix: string;
  crons: ServiceCronEntry[];
}

const CRON_FIELD_NAMES = new Set(['entrypoint', 'schedule']);

export async function getPyprojectCrons(
  workPath: string
): Promise<PyprojectCron[]> {
  const pyprojectPath = join(workPath, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) {
    return [];
  }

  const pyproject = await readConfigFile<Pyproject>(pyprojectPath);
  const crons = pyproject?.tool?.vercel?.crons;
  if (!crons) {
    return [];
  }
  if (typeof crons !== 'object' || Array.isArray(crons)) {
    throw cronConfigError('"tool.vercel.crons" must be an object');
  }

  return Promise.all(
    Object.entries(crons).map(([name, config]) =>
      parseCron(workPath, name, config)
    )
  );
}

export async function resolvePyprojectCronGroups(opts: {
  crons: PyprojectCron[];
  pythonBin: string;
  env: NodeJS.ProcessEnv;
  workPath: string;
}): Promise<ResolvedPyprojectCronGroup[]> {
  return Promise.all(
    opts.crons.map(async cron => {
      const safeName = safePathSegment(cron.name);
      const outputPath = `_py_crons/${safeName}/index`;
      const routePrefix = `/_py_crons/${safeName}/crons`;
      let entries: DynamicCronEntry[];

      if (cron.schedule === undefined) {
        entries = await detectDynamicCrons({
          pythonBin: opts.pythonBin,
          env: opts.env,
          workPath: opts.workPath,
          moduleName: cron.moduleName,
          attrName: cron.variableName,
        });
        if (entries.length === 0) {
          throw cronConfigError(
            `cron "${cron.name}" entrypoint "${cron.moduleName}:${cron.variableName}" returned no entries from get_crons()`
          );
        }
      } else {
        entries = [
          {
            module_function: `${cron.moduleName}:${cron.variableName}`,
            schedule: cron.schedule,
          },
        ];
      }

      const resolvedCrons = entries.map(entry =>
        resolveCronEntry(cron.name, routePrefix, entry)
      );
      validateUniqueSchedules(cron.name, resolvedCrons);

      return {
        name: cron.name,
        entrypoint: cron.entrypoint,
        moduleName: cron.moduleName,
        variableName: cron.variableName,
        outputPath,
        routePrefix,
        crons: resolvedCrons,
      };
    })
  );
}

async function parseCron(
  workPath: string,
  name: string,
  config: RawCron
): Promise<PyprojectCron> {
  if (!isValidConfigName(name)) {
    throw cronConfigError(
      `cron name "${name}" is invalid. Names must start with a letter, end with an alphanumeric character, and contain only alphanumeric characters, hyphens, and underscores`
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw cronConfigError(`cron "${name}" must be an object`);
  }
  for (const key of Object.keys(config)) {
    if (!CRON_FIELD_NAMES.has(key)) {
      throw cronConfigError(`cron "${name}" has unrecognized field "${key}"`);
    }
  }
  if (typeof config.entrypoint !== 'string') {
    throw cronConfigError(
      `cron "${name}" must define string field "entrypoint"`
    );
  }

  const parsedEntrypoint = parseModuleAttrEntrypoint(config.entrypoint);
  if (!parsedEntrypoint) {
    throw cronConfigError(
      `cron "${name}" has invalid entrypoint "${config.entrypoint}". Use "module:function" for a scheduled handler or "module:object" for dynamic get_crons() detection`
    );
  }
  const entrypoint = await resolveExistingEntrypoint(
    workPath,
    parsedEntrypoint.filePath
  );
  if (!entrypoint) {
    throw cronConfigError(
      `cron "${name}" has entrypoint "${config.entrypoint}" but file "${parsedEntrypoint.filePath}" does not exist`
    );
  }

  const schedule = parseSchedule(name, config.schedule);
  return {
    name,
    entrypoint,
    moduleName: parsedEntrypoint.moduleName,
    variableName: parsedEntrypoint.variableName,
    ...(schedule === undefined ? {} : { schedule }),
  };
}

function resolveCronEntry(
  cronName: string,
  routePrefix: string,
  entry: DynamicCronEntry
): ServiceCronEntry {
  const parsedEntrypoint = parseModuleAttrEntrypoint(entry.module_function);
  if (!parsedEntrypoint) {
    throw cronConfigError(
      `cron "${cronName}" returned invalid entrypoint "${entry.module_function}" from get_crons(). Use "module:function"`
    );
  }
  const schedule = parseSchedule(cronName, entry.schedule);
  if (!schedule) {
    throw cronConfigError(
      `cron "${cronName}" returned an entry without a schedule from get_crons()`
    );
  }

  return {
    path: `${routePrefix}/${parsedEntrypoint.moduleName.replace(/\./g, '/')}/${parsedEntrypoint.variableName}`,
    schedule,
    resolvedHandler: entry.module_function,
  };
}

function parseSchedule(name: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw cronConfigError(`cron "${name}" field "schedule" must be a string`);
  }
  if (value === '<dynamic>') {
    throw cronConfigError(
      `cron "${name}" must omit field "schedule" to use dynamic get_crons() detection`
    );
  }
  if (value.length > 256) {
    throw cronConfigError(
      `cron "${name}" field "schedule" must be 256 characters or less`
    );
  }
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw cronConfigError(
      `cron "${name}" field "schedule" must have exactly 5 fields`
    );
  }
  return value;
}

function validateUniqueSchedules(name: string, crons: Cron[]): void {
  const seen = new Set<string>();
  for (const cron of crons) {
    const key = `${cron.path}\0${cron.schedule}`;
    if (seen.has(key)) {
      throw cronConfigError(
        `cron "${name}" produced duplicate entry for path "${cron.path}" and schedule "${cron.schedule}"`
      );
    }
    seen.add(key);
  }
}

function cronConfigError(message: string): NowBuildError {
  return new NowBuildError({
    code: 'PYTHON_INVALID_CRON_CONFIG',
    message,
  });
}
