import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store } from './store.js';
import { callTool } from './tools.js';
export function createBoardServer(store:Store){return createServer({requestTimeout:15000,headersTimeout:10000,connectionsCheckingInterval:1000},async(req,res)=>{
  const address=req.socket.localPort,host=`127.0.0.1:${address}`,origin=`http://${host}`;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')||req.headers.host!==host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'){json(403,{error:'Local same-origin access only'});return;}
  try{
    if(req.method==='GET'&&req.url==='/api/state'){json(200,store.state());return;}
    if(req.method==='POST'&&req.url?.startsWith('/api/tools/')){
      if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'){json(415,{error:'JSON required'});return;}
      const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req.iterator({destroyOnReturn:false})){bytes+=chunk.length;if(bytes>65536){res.setHeader('Connection','close');json(413,{error:'Request too large'});return;}chunks.push(Buffer.from(chunk));}const body=Buffer.concat(chunks).toString('utf8');
      json(200,callTool(store,req.url.slice('/api/tools/'.length),JSON.parse(body)));return;
    }
    const files:Record<string,[string,string]>={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/i18n.js':['i18n.js','text/javascript'],'/style.css':['style.css','text/css']};
    if(req.method==='GET'&&req.url&&Object.hasOwn(files,req.url)){const [file,type]=files[req.url];const content=readFileSync(new URL(`../ui/${file}`,import.meta.url));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});res.end(content);return;}
    json(404,{error:'Not found'});
  }catch(e){if(res.destroyed||res.writableEnded)return;json(400,{error:e instanceof Error?e.message:'Request failed'});}
});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const portText=process.env.PORT??'4317',port=Number(portText);
 if(!/^\d+$/.test(portText)||!Number.isInteger(port)||port<0||port>65535){
   console.error('Task Workspace: PORT must be an integer between 0 and 65535');process.exitCode=1;
 }else{
   let store:Store|undefined;
   try{
     store=new Store();const server=createBoardServer(store),activeStore=store;
     server.on('error',(error:NodeJS.ErrnoException)=>{
       console.error(`Task Workspace: unable to listen on 127.0.0.1:${port} (${error.code??'server error'})`);
       activeStore.close();process.exitCode=1;
     });
     let closing=false;
     const close=()=>{if(closing)return;closing=true;const deadline=setTimeout(()=>server.closeAllConnections(),5000);deadline.unref();server.close(()=>{clearTimeout(deadline);activeStore.close();process.exit(0);});};
     process.on('SIGINT',close);process.on('SIGTERM',close);
     server.listen(port,'127.0.0.1',()=>console.log(`Task Workspace: http://127.0.0.1:${(server.address() as {port:number}).port}`));
   }catch(error){store?.close();console.error(`Task Workspace: ${error instanceof Error?error.message:'Startup failed'}`);process.exitCode=1;}
 }
}
