import { lstatSync } from 'fs-extra';
import { isAbsolute, relative, sep } from 'path';
import { DeploymentError } from './errors';
import type { VercelClientOptions } from './types';
import { createTgzFiles } from './utils/archive';
import { hashes } from './utils/hashes';
import { buildFileTree, createDebug } from './utils';

export interface DeploymentFileItem {
  path: string;
  size: number;
  mode: number;
  sha?: string;
}

export interface DeploymentFileSummary {
  basePath: string;
  fileCount: number;
  totalSize: number;
  ignoredCount: number;
  files: DeploymentFileItem[];
  ignored: string[];
}

export async function inspectDeploymentFiles(
  clientOptions: Pick<
    VercelClientOptions,
    | 'archive'
    | 'bulkRedirectsPath'
    | 'debug'
    | 'path'
    | 'prebuilt'
    | 'projectName'
    | 'rootDirectory'
    | 'vercelOutputDir'
  >
): Promise<DeploymentFileSummary> {
  const { path } = clientOptions;
  const debug = createDebug(clientOptions.debug);

  if (typeof path !== 'string' && !Array.isArray(path)) {
    throw new DeploymentError({
      code: 'missing_path',
      message: 'Path not provided',
    });
  }

  const isDirectory = !Array.isArray(path) && lstatSync(path).isDirectory();

  if (Array.isArray(path)) {
    for (const filePath of path) {
      if (!isAbsolute(filePath)) {
        throw new DeploymentError({
          code: 'invalid_path',
          message: `Provided path ${filePath} is not absolute`,
        });
      }
    }
  } else if (!isAbsolute(path)) {
    throw new DeploymentError({
      code: 'invalid_path',
      message: `Provided path ${path} is not absolute`,
    });
  }

  const options = { ...clientOptions, isDirectory };
  const { fileList, ignoreList } = await buildFileTree(path, options, debug);
  const workPath = typeof path === 'string' ? path : path[0];

  const filesMap =
    clientOptions.archive === 'tgz'
      ? await createTgzFiles(workPath, fileList, debug)
      : await hashes(fileList);

  const files: DeploymentFileItem[] = [];
  let totalSize = 0;

  for (const [sha, file] of filesMap) {
    if (typeof sha === 'undefined') continue;

    const size = file.data?.byteLength || file.data?.length || 0;
    for (const name of file.names) {
      const pathName = isDirectory
        ? relative(workPath, name)
        : name.split(sep).at(-1) || name;
      const normalizedPath = pathName.split(sep).join('/');
      files.push({
        path: normalizedPath,
        size,
        mode: file.mode,
        sha,
      });
      totalSize += size;
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    basePath: workPath,
    fileCount: files.length,
    totalSize,
    ignoredCount: ignoreList.length,
    files,
    ignored: ignoreList.sort(),
  };
}
