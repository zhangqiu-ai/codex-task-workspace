import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const defaultHome=()=>process.env.TASK_WORKSPACE_HOME||join(homedir(),'.local/share/codex-task-workspace');
export function inspectDatabase(file:string){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN');
  const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if(version!==1)throw new Error(`Unsupported schema version: ${version}`);
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('Database integrity check failed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database foreign key check failed');
  const counts:Record<string,number>={};
  for(const table of ['workspaces','projects','tasks','sessions','task_sessions','session_assessments','memory_facts','git_links','hook_events'])counts[table]=Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  if(!db.prepare("SELECT id FROM workspaces WHERE id='local'").get())throw new Error('Local workspace missing');
  db.exec('COMMIT');return {schema:version,integrity:'ok',counts};
 }finally{db.close();}
}
export function backupDatabase(home:string,destination:string){
 const source=join(resolve(home),'workspace.sqlite'),target=resolve(destination);
 if(existsSync(target))throw new Error('Backup destination already exists');
 inspectDatabase(source);
 // A private staging directory avoids exposing a partially written snapshot.
 const staging=`${target}.pending-${randomUUID()}`;mkdirSync(staging,{mode:0o700});
 const snapshot=join(staging,'workspace.sqlite');
 try{
  const db=new DatabaseSync(source,{readOnly:true});
  try{db.exec('PRAGMA busy_timeout=5000');db.prepare('VACUUM INTO ?').run(snapshot);}finally{db.close();}
  chmodSync(snapshot,0o600);const checks=inspectDatabase(snapshot);
  // Reserve target exclusively; never overwrite an existing backup.
  mkdirSync(target,{mode:0o700});renameSync(snapshot,join(target,'workspace.sqlite'));
  return {backup:target,...checks};
 }finally{rmSync(staging,{recursive:true,force:true});}
}
export function restoreDatabase(backup:string,destination:string){
 // Restore is intentionally into a fresh home, never over an active database/WAL.
 return backupDatabase(backup,destination);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [command,...args]=process.argv.slice(2);
  if(command==='doctor'&&args.length===0)console.log(JSON.stringify({home:resolve(defaultHome()),...inspectDatabase(join(defaultHome(),'workspace.sqlite'))},null,2));
  else if(command==='backup'&&args.length===1)console.log(JSON.stringify(backupDatabase(defaultHome(),args[0]),null,2));
  else if(command==='restore'&&args.length===2)console.log(JSON.stringify(restoreDatabase(args[0],args[1]),null,2));
  else throw new Error('Usage: maintenance doctor | backup NEW_DIRECTORY | restore BACKUP_DIRECTORY NEW_DATA_DIRECTORY');
 }catch(error){console.error(error instanceof Error?error.message:'Maintenance failed');process.exitCode=1;}
}
