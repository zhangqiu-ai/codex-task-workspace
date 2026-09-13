import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

export type CodexProject = {name:string;path:string};
export const codexHome = () => process.env.TASK_WORKSPACE_CODEX_HOME || process.env.CODEX_HOME || join(homedir(), '.codex');
export function canonicalDirectory(path:string):string|undefined {
  if(!isAbsolute(path))return;
  try {const canonical=realpathSync(path);return statSync(canonical).isDirectory()?canonical:undefined;}catch{return;}
}
const object=(value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const inside=(path:string,root:string) => {const rel=relative(root,path);return rel===''||(!rel.startsWith(`..${sep}`)&&rel!=='..'&&!isAbsolute(rel));};

// Read-only compatibility adapter for observed Codex desktop state (2026-09-13).
// These are internal fields, not a stable public API. Never read session history
// or treat all thread working directories as saved projects. Unknown shapes fail closed.
export function discoverCodexProjects(home=codexHome()):{projects:CodexProject[];warning?:string} {
  let state:unknown;
  try {state=JSON.parse(readFileSync(join(home,'.codex-global-state.json'),'utf8'));}
  catch {return {projects:[],warning:'codex_state_unavailable'};}
  if(!object(state))return {projects:[],warning:'codex_state_invalid'};
  const modern=state['local-projects'],legacy=state['electron-saved-workspace-roots'];
  if((modern!==undefined&&!object(modern))||(legacy!==undefined&&(!Array.isArray(legacy)||legacy.some(p=>typeof p!=='string'))))return {projects:[],warning:'codex_state_invalid'};
  if(modern===undefined&&legacy===undefined)return {projects:[],warning:'codex_state_unsupported'};
  const mirror=join(home,'.chatgpt-projects');
  const excluded=[mirror,canonicalDirectory(mirror),join(homedir(),'.codex','.chatgpt-projects')].filter((p):p is string=>!!p);
  const projects=new Map<string,CodexProject>();
  const add=(path:unknown,name?:unknown)=>{
    if(typeof path!=='string')return;
    const canonical=canonicalDirectory(path);
    if(!canonical||excluded.some(root=>inside(path,root)||inside(canonical,root)))return;
    if(!projects.has(canonical))projects.set(canonical,{path:canonical,name:typeof name==='string'&&name.trim()?name.trim().slice(0,240):basename(canonical)});
  };
  if(object(modern)){
    // Primary roots first preserve each saved project's label if shared as an extra root elsewhere.
    const entries=Object.entries(modern).filter(([id,p])=>!id.startsWith('g-p-')&&object(p)&&!(typeof p.id==='string'&&p.id.startsWith('g-p-')));
    for(const [,p] of entries){if(object(p)&&Array.isArray(p.rootPaths))add(p.rootPaths[0],p.name);}
    for(const [,p] of entries){if(object(p)&&Array.isArray(p.rootPaths))for(const path of p.rootPaths.slice(1))add(path);}
  }
  if(Array.isArray(legacy))for(const path of legacy)add(path);
  return {projects:[...projects.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.path.localeCompare(b.path))};
}
