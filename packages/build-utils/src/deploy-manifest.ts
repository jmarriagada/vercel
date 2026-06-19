import type { PackageManifest } from './package-manifest';

export interface DeployManifestService extends PackageManifest {
  root: string;
  builder: string;
}

export interface DeployManifest {
  manifestVersion: '2.0';
  services: Record<string, DeployManifestService>;
}
