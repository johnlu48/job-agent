import { Store,rank } from './core.ts';
const store=new Store('data/offline-demo.sqlite');
try{
 for(const job of [
 {id:'offline:distributed',company:'SYNTHETIC LOCAL FIXTURE',title:'Senior Software Engineer - Distributed Systems',location:'Austin, TX',url:'https://example.invalid/jobs/distributed',description:'AWS DynamoDB distributed systems IoT orchestration'},
 {id:'offline:ai',company:'SYNTHETIC LOCAL FIXTURE',title:'Senior Software Engineer - AI Platform',location:'Remote US',url:'https://example.invalid/jobs/ai',description:'AI platform observability WorkcellAI. Disclosed base salary range $250,000 - $320,000. Equity unspecified.'}
 ])store.save(rank(job));
 console.log('OFFLINE DRY RUN: synthetic jobs only; no browser requests or applications.');
 console.log(JSON.stringify(store.jobs(),null,2));
 console.log('Applications:',store.db.prepare('SELECT count(*) count FROM applications').get());
 store.log('offline_dry_run','','No applications attempted');
}finally{store.close();}
