export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';
export interface Workspace { id: string; name: string; active_task_id: string | null }
export interface Project { id: string; workspace_id: string; name: string; repo_path: string | null }
export interface Task { id: string; project_id: string; title: string; status: TaskStatus; focus: number; created_at: string; updated_at: string }
export interface Session { id: string; title: string; cwd: string | null; updated_at: string; created_at: string }
export interface TaskSession { task_id: string; session_id: string; attached_at: string }
export type MemoryScope = 'project' | 'task';
export type MemoryAuthority = 'user' | 'verified_code' | 'test_result' | 'ai_inference';
export interface MemoryFact { id: string; project_id: string | null; task_id: string | null; kind: string; content: string; evidence: string; authority: MemoryAuthority; confidence: number; status: 'active' | 'superseded'; superseded_by: string | null; created_at: string }
export interface SessionAssessment { session_id: string; task_id: string; summary: string; relevance: number; implementation: number; authority: number; actionability: number; superseded: boolean; evidence: string }
export interface HookInput { event_id: string; event_name: 'SessionStart' | 'Stop' | 'SessionEnd'; session_id: string; cwd?: string; at?: string }
export interface GitLink { id: string; task_id: string; session_id: string | null; repo_path: string; branch: string; commit_sha: string | null }
