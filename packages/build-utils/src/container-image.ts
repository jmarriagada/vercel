import type { Env, Files } from './types';

export interface ContainerImageConfig {
  /** The OCI image reference (e.g. `vcr.vercel.com/team/project/svc@sha256:...`). */
  image: string;
  runtime: 'container';
  command?: string[];
  environment?: Env;
}

export class ContainerImage {
  type: 'ContainerImage';
  files: Files;
  /** The OCI image reference (e.g. `vcr.vercel.com/team/project/svc@sha256:...`). */
  image: string;
  runtime: 'container';
  command?: string[];
  environment: Env;

  constructor(params: Omit<ContainerImage, 'type'>) {
    this.type = 'ContainerImage';
    this.files = params.files;
    this.image = params.image;
    this.runtime = params.runtime;
    this.command = params.command;
    this.environment = params.environment;
  }
}
