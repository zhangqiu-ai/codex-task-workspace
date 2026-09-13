import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from './store.js';
import { toolDefinitions } from './tools.js';
const store = new Store();
const server = new McpServer({name:'codex-task-workspace',version:'0.1.0'});
for(const [name,def] of Object.entries(toolDefinitions(store))){
  server.registerTool(name,{description:def.description,inputSchema:def.schema.shape},async (args: Record<string, unknown>)=>{
    try {const result=def.run(def.schema.parse(args) as any);return {content:[{type:'text' as const,text:JSON.stringify(result)}]};}
    catch(e){return {isError:true,content:[{type:'text' as const,text:e instanceof Error?e.message:'Tool failed'}]};}
  });
}
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try { await server.close(); }
  finally { store.close(); }
}
function stop(): void {
  void shutdown().catch(() => {
    process.stderr.write('Task Workspace: MCP shutdown failed.\n');
    process.exitCode = 1;
  });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.stdin.once('end', stop);
try { await server.connect(new StdioServerTransport()); }
catch {
  await shutdown();
  process.stderr.write('Task Workspace: MCP startup failed.\n');
  process.exitCode = 1;
}
