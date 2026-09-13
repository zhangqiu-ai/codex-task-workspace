// Use the original profile. Never run both hosts against it at the same time.
#include <mach-o/dyld.h>
#include <libproc.h>
#include <CoreFoundation/CoreFoundation.h>
#include <limits.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int fail(const char *message){
 fprintf(stderr,"%s\n",message);
 if(!getenv("WORKSPACE_LAUNCHER_TEST")){
  CFStringRef text=CFStringCreateWithCString(NULL,message,kCFStringEncodingUTF8);
  CFUserNotificationDisplayAlert(0,kCFUserNotificationStopAlertLevel,NULL,NULL,NULL,CFSTR("Task Workspace"),text,CFSTR("OK"),NULL,NULL,NULL);
  CFRelease(text);
 }
 return 1;
}
static int line(FILE *file,char *value,size_t size){
 if(!fgets(value,(int)size,file)||!strchr(value,'\n'))return 0;
 value[strcspn(value,"\r\n")]=0;return value[0]=='/';
}
int main(int argc,char **argv){
 char raw[PATH_MAX],executable[PATH_MAX],host[PATH_MAX],config[PATH_MAX],home[PATH_MAX],profile[PATH_MAX],original[PATH_MAX],arg[PATH_MAX+32];
 uint32_t size=sizeof(raw);
 if(_NSGetExecutablePath(raw,&size)||!realpath(raw,executable))return fail("Cannot locate Workspace launcher");
 const char *macos=dirname(executable);
 snprintf(host,sizeof(host),"%s/ChatGPT",macos);
 snprintf(config,sizeof(config),"%s/../Resources/workspace-host-paths",macos);
 FILE *file=fopen(config,"r");if(!file)return fail("Missing shared host configuration; reinstall Workspace");
 int valid=line(file,home,sizeof(home))&&line(file,profile,sizeof(profile))&&line(file,original,sizeof(original));fclose(file);
 if(!valid)return fail("Invalid shared host configuration");
 int count=proc_listallpids(NULL,0);if(count<=0)return fail("Cannot verify running Codex processes");
 size_t capacity=(size_t)count+128;pid_t *pids=calloc(capacity,sizeof(pid_t));if(!pids)return 1;
 count=proc_listallpids(pids,(int)(capacity*sizeof(pid_t)));
 if(count<=0||count>(int)capacity){free(pids);return fail("Cannot verify running Codex processes");}
 for(int i=0;i<count;i++){
  if(pids[i]==getpid())continue;
  if(proc_pidpath(pids[i],raw,sizeof(raw))>0&&(!strcmp(raw,original)||!strcmp(raw,host))){free(pids);return fail("请先退出正在运行的 Codex，再打开工作台副本。两者共用配置、项目和任务历史。\nQuit the running Codex before opening Workspace. Both use the same profile.");}
 }
 free(pids);
 setenv("CODEX_HOME",home,1);setenv("CODEX_ELECTRON_USER_DATA_PATH",profile,1);setenv("WORKSPACE_SHARED_PROFILE_READY","1",1);
 snprintf(arg,sizeof(arg),"--user-data-dir=%s",profile);
 char **args=calloc((size_t)argc+2,sizeof(char*));if(!args)return 1;
 args[0]=host;for(int i=1;i<argc;i++){
  if(!strncmp(argv[i],"--user-data-dir",15))return fail("Custom profile overrides are not supported");
  args[i]=argv[i];
 }args[argc]=arg;
 execv(host,args);return fail("Workspace host failed to launch");
}
