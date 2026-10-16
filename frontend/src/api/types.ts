import type {components} from './generated';
type Schema=components['schemas'];
export type CheckKey=Schema['RunDTO']['checks'][number];
export type ExecutionStatus=Schema['UnitSummary']['status'];
export type Finding=NonNullable<Schema['UnitSummary']['finding']>;
export type ErrorDetail=Schema['ErrorDetail'];
export type SourceSpan=Schema['SourceSpan'];
export type ReportDTO=Schema['ReportDTO'];
export type Counts=Schema['Counts'];
export type RunDTO=Schema['RunDTO'];
export interface Page<T>{items:T[];total:number;page:number;page_size:number}
export type UnitSummary=Schema['UnitSummary'];
export interface RunReport{id:string;run_id:string;report_id:string|null;original_row:number|null;description:string;diagnosis:string;extra_fields:Record<string,unknown>;errors:unknown[];invalid:boolean;results:Partial<Record<CheckKey,UnitSummary>>;completeness:string;anomaly:string}
export interface Outcome{status:ExecutionStatus;finding:Finding|null;spans?:SourceSpan[];suggestions?:Array<{start?:number;end?:number;before?:string;after?:string;text?:string}>;details?:Record<string,unknown>;error?:ErrorDetail|null;stages?:unknown[]}
export type ReviewType='accept'|'reject'|'edit'|'defer';
export type ReviewDTO=Schema['ReviewDTO'];
export type ReviewTaskDTO=Schema['ReviewTaskDTO'];
export type ReviewReportDTO=RunReport&{pending_results:number;pending_branches:CheckKey[]};
export interface ResultDTO{id:string;run_id:string;run_report_id:string;branch:CheckKey;generation:number;review_revision:number;source_field:'description'|'diagnosis';source:string;outcome:Outcome;attempts:Array<{id:string;stage:string;generation:number;status:string;attempt_no:number;error?:ErrorDetail}>;reviews:ReviewDTO[];versions:unknown[]}
export type Candidate=Schema['Candidate'];
export type EvidenceSnapshot=Schema['EvidenceSnapshot'];
export interface ImportDTO{id:string;status:string;filename:string;columns:string[];preview_rows:Array<{original_row:number;cells:Record<string,string>;errors:unknown[]}>;errors:ErrorDetail[];confirmed:boolean;mapping:{description_column:string;diagnosis_column:string|null}|null;checks:CheckKey[]|null;total_rows:number;valid_rows:number;invalid_rows:Array<{original_row:number;errors:unknown[]}>}
export type ArtifactDTO=Schema['ArtifactDTO'];
export interface PreflightDTO{ready:boolean;branches:Partial<Record<CheckKey,{ready:boolean;reasons:ErrorDetail[]}>>;identities:unknown[];capacity:Record<string,unknown>}
export interface Summary{run_total:number;report_total:number;review_pending:number;running_runs:number;review_by_branch?:Partial<Record<CheckKey,number>>}
