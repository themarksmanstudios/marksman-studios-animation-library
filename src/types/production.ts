export type BlenderJobStatus = 'prepared' | 'queued' | 'running' | 'complete' | 'partial' | 'failed';

export interface ProductionProject {
  animationId: string;
  title: string;
  directory: string;
  status: BlenderJobStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  outputs?: string[];
  sourceFiles?: Array<{ role: string; path: string }>;
  missingInputs?: string[];
}
