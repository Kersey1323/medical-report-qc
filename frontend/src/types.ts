export type CheckKey = 'diagnosis' | 'csc' | 'cgec' | 'rag';
export type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type Finding = 'no_issue' | 'issue' | 'needs_review';
export type ReviewType = 'accept' | 'reject' | 'edit' | 'defer';
export type ModuleResult = { status: ExecutionStatus; finding?: Finding };
export type Report = {
  id: string; name: string; time: string; source: 'batch' | 'single';
  description: string; diagnosis: string; results: Record<CheckKey, ModuleResult>;
};
export type ReviewDecision = { type: ReviewType; text?: string; note?: string };
export type Decisions = Record<string, ReviewDecision>;
export type Task = {
  id: string; name: string; reports: number; time: string;
  status: 'partial' | 'completed' | 'running' | 'cancelled';
  progress?: number; checks?: CheckKey[];
};
export type Filter = 'all' | 'issue' | 'partial' | 'review' | 'normal';
export type Navigate = (path: string) => void;
export type Notify = (message: string) => void;
