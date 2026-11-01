import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Store} from './core.ts';
export function reportRows(store:Store){return store.jobs().map(j=>{
 const attempt=store.application(j.id) as any;
 const result=store.db.prepare('SELECT * FROM application_results WHERE job_id=?').get(j.id) as any;
 const status=attempt?.status||result?.status||'discovered';
 const salary=j.salary?JSON.stringify(j.salary):j.compensation?JSON.stringify(j.compensation):[...j.description.matchAll(/\$[\d,]+(?:\.\d+)?\s*[kK]?/g)].map(m=>m[0]).join(' / ')||'Not disclosed';
 return {job_id:j.id,company:j.company,title:j.title,location:j.location,compensation:salary,compensation_note:'Reported salary is not total compensation; equity/bonus unverified',status,submitted_date:attempt?.submitted_day||'',submitted_at:attempt?.submitted_at||'',error:attempt?(status==='submitted'?'':attempt.detail||'Submission pending; outcome requires verification'):result?.error||'',resume:j.resume||'',score:j.score||0,job_url:j.url,application_url:j.applicationUrl||'',attribution_name:j.attribution?.name||j.source||'',attribution_url:j.attribution?.url||j.url,confirmation_url:attempt?.confirmation_url||result?.confirmation_url||'',screenshot:attempt?.screenshot||result?.screenshot||'',updated_at:result?.updated_at||attempt?.day||'',flags:(j.flags||[]).join('; ')};
});}
export function exportReport(store:Store,directory=store.reportDirectory){
 mkdirSync(directory,{recursive:true});const rows=reportRows(store);const columns=['job_id','company','title','location','compensation','compensation_note','status','submitted_date','submitted_at','error','resume','score','job_url','application_url','attribution_name','attribution_url','confirmation_url','screenshot','updated_at','flags'] as const;
 const csv=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 writeFileSync(join(directory,'applications.csv'),'\uFEFF'+[columns.map(csv).join(','),...rows.map(r=>columns.map(c=>csv(r[c])).join(','))].join('\r\n')+'\r\n');
 writeFileSync(join(directory,'applications.json'),JSON.stringify(rows,null,2)+'\n');
 const escape=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 writeFileSync(join(directory,'applications.html'),'<!doctype html><meta charset="utf-8"><title>Job discovery and applications</title><h1>Job discovery and applications</h1><p>Salary disclosures are not verified total compensation.</p><table border="1"><thead><tr>'+columns.map(c=>'<th>'+escape(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+columns.map(c=>'<td>'+(c==='attribution_url'&&/^https:\/\//.test(r[c])?'<a href="'+escape(r[c])+'">'+escape(r.attribution_name||'Source')+'</a>':escape(r[c]))+'</td>').join('')+'</tr>').join('')+'</tbody></table>');return rows;
}
