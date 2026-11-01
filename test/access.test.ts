import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {accessControlledFetch,robotsPolicy} from '../src/access.ts';
test('robots rules combine repeated wildcard groups and respect agent-specific longest match',()=>{
 assert.equal(robotsPolicy('User-agent: *\nDisallow: /api\nAllow: /api/public','/api/private').allowed,false);assert.equal(robotsPolicy('User-agent: *\nDisallow: /api\nAllow: /api/public','/api/public').allowed,true);
 assert.equal(robotsPolicy('User-agent: *\nAllow: /\nUser-agent: JobApplicationAgent\nDisallow: /','/api').allowed,false);
 assert.equal(robotsPolicy('User-agent: *\nAllow: /\nUser-agent: *\nDisallow: /private','/private').allowed,false);
 assert.equal(robotsPolicy('User-agent: *\nCrawl-delay: 5\nAllow: /','/api').delay,5000);
});
test('public access caches permitted API responses, spaces requests, and refuses disallowed endpoints',async()=>{
 const root=mkdtempSync(join(tmpdir(),'access-'));const urls:string[]=[];const waits:number[]=[];
 const request=accessControlledFetch({sleep:async ms=>{waits.push(ms);},fetch:async(input,init)=>{urls.push(String(input));assert.match(new Headers(init?.headers).get('User-Agent')||'',/JobApplicationAgent/);return String(input).endsWith('/robots.txt')?new Response('User-agent: *\nDisallow: /private\nCrawl-delay: 2'):new Response('[{"id":1}]',{headers:{'Content-Type':'application/json'}});}},root);
 await request('https://remoteok.com/api');await request('https://remoteok.com/api');assert.equal(urls.length,2);assert(waits[0]>0);await assert.rejects(()=>request('https://remoteok.com/private'),/robots.txt disallows/);assert.equal(urls.length,2);
});
test('unreadable robots policy fails closed and does not retry a blocked origin for other employers',async()=>{
 let requests=0;const request=accessControlledFetch({fetch:async()=>{requests++;return new Response('',{status:403});}},mkdtempSync(join(tmpdir(),'access-')));
 await assert.rejects(()=>request('https://example.invalid/one'),/Cannot verify robots/);await assert.rejects(()=>request('https://example.invalid/two'),/Cannot verify robots/);assert.equal(requests,1);
});
