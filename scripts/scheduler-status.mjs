// Read-only guard: do not instantiate Store or create a missing database.
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
let submittedToday=false;
const path=resolve(root,'data/agent.sqlite');
if(existsSync(path)){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('PRAGMA busy_timeout=5000');
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='applications'").get()){
   const columns=db.prepare('PRAGMA table_info(applications)').all();
   const date=columns.some(c=>c.name==='submitted_day')?'COALESCE(submitted_day,day)':'day';
   submittedToday=!!db.prepare(`SELECT 1 FROM applications WHERE status='submitted' AND ${date}=? LIMIT 1`).get(today);
  }
 }finally{db.close();}
}
console.log(JSON.stringify({today,submittedToday}));
