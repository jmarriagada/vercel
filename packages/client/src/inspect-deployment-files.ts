import { relative, sep } from 'path';
import { collectDeploymentFiles } from './collect-deployment-files';
import type { VercelClientOptions } from './types';
import { createDebug } from './utils';

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
  const { filesMap, workPath, isDirectory, ignoreList } =
    await collectDeploymentFiles(path, clientOptions, debug);

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
