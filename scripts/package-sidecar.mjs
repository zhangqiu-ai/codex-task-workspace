import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Task Workspace sidecar currently supports macOS Apple Silicon');
const output=path.resolve(process.argv[2]||path.join(repo,'.data/delivery/Task Workspace.app'));
if(fs.existsSync(output))throw Error('Package destination already exists');
const officialApp='/Applications/ChatGPT.app';
if(output===officialApp||output.startsWith(officialApp+path.sep))throw Error('Refusing to package inside the official Codex application');
const stage=path.join(path.dirname(output),`.${path.basename(output)}.stage-${crypto.randomUUID()}`);
execFileSync('npm',['test'],{cwd:repo,stdio:'inherit'});
execFileSync('npm',['run','test:e2e'],{cwd:repo,stdio:'inherit'});
try {
const contents=path.join(stage,'Contents'),macos=path.join(contents,'MacOS'),resources=path.join(contents,'Resources');
fs.mkdirSync(macos,{recursive:true});fs.mkdirSync(resources,{recursive:true});
fs.copyFileSync(path.join(repo,'integrations/appkit-sidecar/Info.plist'),path.join(contents,'Info.plist'));
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(repo,name),path.join(resources,name));
execFileSync('/usr/bin/swiftc',['-parse-as-library','-O','-framework','AppKit','-framework','CoreGraphics','-framework','WebKit',path.join(repo,'integrations/appkit-sidecar/TaskWorkspaceApp.swift'),'-o',path.join(macos,'TaskWorkspace')]);
const runtime=path.join(resources,'workspace-runtime');fs.mkdirSync(runtime);
for(const name of ['dist','ui','package.json','package-lock.json'])fs.cpSync(path.join(repo,name),path.join(runtime,name),{recursive:true});
execFileSync('npm',['ci','--omit=dev','--ignore-scripts'],{cwd:runtime,stdio:'inherit'});
const packagedNode=path.join(repo,'.data/downloads/node-v22.22.3-darwin-arm64.tar.gz');
if(!fs.existsSync(packagedNode))throw Error('Verified Node archive is missing; run the documented release preparation first');
const sums=fs.readFileSync(path.join(repo,'.data/downloads/SHASUMS256.txt'),'utf8');
const expected=sums.split(/\r?\n/).find(line=>line.endsWith('  node-v22.22.3-darwin-arm64.tar.gz'))?.split(/\s+/)[0];
const actual=crypto.createHash('sha256').update(fs.readFileSync(packagedNode)).digest('hex');
if(!expected||actual!==expected)throw Error('Packaged Node archive checksum does not match SHASUMS256.txt');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'task-workspace-node-'));
try{
 execFileSync('tar',['-xzf',packagedNode,'-C',temporary]);
 fs.copyFileSync(path.join(temporary,'node-v22.22.3-darwin-arm64/bin/node'),path.join(runtime,'node'));fs.chmodSync(path.join(runtime,'node'),0o755);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',stage]);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',stage]);
fs.renameSync(stage,output);
} catch (error) {
 fs.rmSync(stage,{recursive:true,force:true});
 throw error;
}
console.log(output);
