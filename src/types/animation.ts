export const STATUSES = ['Planned', 'Captured', 'Cleaning', 'Retargeting', 'Review', 'Published'] as const;
export const PRIORITIES = ['Normal', 'Low', 'High', 'Urgent'] as const;

export interface AnimationReference {
  id: string;
  title: string;
  url: string;
  kind: 'image' | 'video' | 'link';
  createdAt: string;
}

export type AnimationStatus = (typeof STATUSES)[number];
export type AnimationPriority = (typeof PRIORITIES)[number];
export type StatusFilter = AnimationStatus | 'All';

export interface Animation {
  id: string;
  title: string;
  category: string;
  status: AnimationStatus;
  collection: string;
  subcategory: string;
  region: string;
  actors: string;
  tags: string[];
  hashtags: string;
  captureNotes: string;
  references: AnimationReference[];
  owner: string;
  priority: AnimationPriority;
  dueDate: string;
  description: string;
  updatedAt: string;
}

export type AnimationInput = Omit<Animation, 'id' | 'updatedAt'>;
export interface ImportResult { imported: number; skipped: number; total: number }
