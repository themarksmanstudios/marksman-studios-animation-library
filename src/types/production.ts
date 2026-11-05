export type BlenderJobStatus = 'prepared' | 'queued' | 'running' | 'complete' | 'partial' | 'failed';
export type ProductionAction = 'glb' | 'gif' | 'fbx';

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
  gifResolution?: { width: number; height: number };
  completedActions?: ProductionAction[];
  currentAction?: ProductionAction | null;
  lastFailedAction?: ProductionAction | null;
}
