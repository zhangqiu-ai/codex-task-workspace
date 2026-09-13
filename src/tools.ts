import { z } from 'zod';
import { Store } from './store.js';
const id=z.string().trim().min(1).max(200),text=z.string().trim().min(1).max(12000),name=z.string().trim().min(1).max(240),unit=z.number().min(0).max(1),scope=z.enum(['project','task']);
export function toolDefinitions(store:Store) {
  return {
    list_workspace:{description:'Read local projects, tasks, unassigned inbox sessions and hook health.',schema:z.object({}).strict(),run:()=>store.state()},
    create_project:{description:'Create a project in the local workspace. Repository is optional.',schema:z.object({name,repo_path:z.string().min(1).optional()}).strict(),run:(a:any)=>store.createProject(a)},
    list_codex_projects:{description:'List saved Codex local project directories available for explicit import. Reads desktop settings only; excludes ChatGPT mirrors and missing directories.',schema:z.object({}).strict(),run:()=>store.listCodexProjects()},
    import_codex_project:{description:'Import one currently saved Codex local directory into this workspace. Deduplicates canonical paths; does not copy files or import sessions.',schema:z.object({path:z.string().min(1).max(4096)}).strict(),run:(a:any)=>store.importCodexProject(a)},
    create_task:{description:'Create a task belonging to exactly one project.',schema:z.object({project_id:id,title:name}).strict(),run:(a:any)=>store.createTask(a)},
    update_task:{description:'Set task project, status or Focus explicitly. Moving project preserves task memory and sessions; project memory stays with its project.',schema:z.object({task_id:id,project_id:id.optional(),status:z.enum(['todo','doing','blocked','done']).optional(),focus:z.boolean().optional()}).strict(),run:(a:any)=>store.updateTask(a)},
    set_active_task:{description:'Select or clear the one active task; does not reassign sessions.',schema:z.object({task_id:id.nullable()}).strict(),run:(a:any)=>store.setActive(a)},
    attach_session:{description:'Attach or explicitly move a session to a task; clears obsolete assessment when moved.',schema:z.object({task_id:id,session_id:id,title:name.optional()}).strict(),run:(a:any)=>store.attach(a)},
    assess_session:{description:'Save AI extracted session assessment with evidence. Scores describe usefulness, not task completion percentages.',schema:z.object({task_id:id,session_id:id,summary:text,relevance:unit,implementation:unit,authority:unit,actionability:unit,superseded:z.boolean(),evidence:text}).strict(),run:(a:any)=>store.assess(a)},
    rank_task_sessions:{description:'Return deterministic evidence based ranking; explicitly mark recency fallback.',schema:z.object({task_id:id}).strict(),run:(a:any)=>store.rank(a.task_id)},
    record_memory:{description:'Store an evidence-bearing project/task fact; optionally supersede an active fact in the same scope. Regenerate Markdown.',schema:z.object({scope,scope_id:id,kind:z.enum(['state','decision','next_action','issue']),content:text,evidence:text,authority:z.enum(['user','verified_code','test_result','ai_inference']),confidence:unit.optional(),supersedes:id.optional()}).strict(),run:(a:any)=>store.recordMemory(a)},
    materialize_memory:{description:'Rebuild a disposable Markdown memory view from SQLite.',schema:z.object({scope,scope_id:id}).strict(),run:(a:any)=>store.materialize(a.scope,a.scope_id)},
    get_task_context:{description:'Read current task/project memory, sessions and Git references directly from SQLite.',schema:z.object({task_id:id}).strict(),run:(a:any)=>store.context(a.task_id)},
    continue_task:{description:'Set Active Task and prepare current context plus a continuation prompt. Does not launch or send to a session.',schema:z.object({task_id:id}).strict(),run:(a:any)=>store.continueTask(a.task_id)},
    prepare_promote:{description:'Prepare a reviewable knowledge draft for authoritative documentation. Writes no repository files.',schema:z.object({fact_id:id,target:z.enum(['AGENTS.md','ADR','architecture'])}).strict(),run:(a:any)=>store.promote(a)},
    link_git:{description:'Record explicit repository, branch and optional commit reference; does not verify or mutate Git.',schema:z.object({task_id:id,session_id:id.optional(),repo_path:text,branch:name,commit_sha:z.string().regex(/^[a-fA-F0-9]{7,64}$/).optional()}).strict(),run:(a:any)=>store.linkGit(a)},
    hook_health:{description:'Inspect actual received lifecycle events; unknown is not healthy.',schema:z.object({}).strict(),run:()=>store.health()}
  };
}
export function callTool(store:Store,name:string,args:unknown){const defs=toolDefinitions(store);if(!Object.hasOwn(defs,name))throw new Error('Unknown tool');const def=defs[name as keyof typeof defs];return def.run(def.schema.parse(args??{}) as any);}
