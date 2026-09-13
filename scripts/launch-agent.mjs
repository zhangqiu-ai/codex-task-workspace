// Generate a reviewable macOS login-service file. Does not install or load it.
import {writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
const [runtimeArg,outputArg]=process.argv.slice(2);
if(!runtimeArg||!outputArg)throw Error('Usage: node scripts/launch-agent.mjs RUNTIME_DIRECTORY NEW_PLIST_PATH');
const runtime=resolve(runtimeArg),output=resolve(outputArg),home=resolve(process.env.TASK_WORKSPACE_HOME||join(homedir(),'.local/share/codex-task-workspace'));
if(!existsSync(join(runtime,'dist/http.js')))throw Error('Built runtime missing');
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
writeFileSync(output,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.codex-task-workspace</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(runtime,'dist/http.js'))}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>EnvironmentVariables</key><dict><key>TASK_WORKSPACE_HOME</key><string>${xml(home)}</string><key>PORT</key><string>4317</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer>
</dict></plist>\n`,{flag:'wx',mode:0o600});
console.log(`Prepared ${output}; not installed. Data home: ${home}. MCP and hooks must use the same home.`);
