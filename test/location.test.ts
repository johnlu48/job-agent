import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jobLocation} from '../src/location.ts';
import {rank} from '../src/core.ts';
test('escaped Greenhouse location headers recover Austin without guessing from company office mentions',()=>{
 const description='&lt;h3&gt;&lt;strong&gt;Available Locations: Austin, TX | New York, NY | London, UK (Hybrid)&lt;/strong&gt;&lt;/h3&gt;&lt;p&gt;Distributed systems backend AWS.&lt;/p&gt;';
 const location=jobLocation('In-Office',description);assert.match(location,/Austin, TX/);assert(!location.includes('Distributed systems'));
 const job=rank({id:'a',company:'fixture',title:'Senior Software Engineer',url:'https://example.invalid/a',location:'In-Office',description});assert(!job.flags?.includes('LOCATION_REVIEW'));
 assert.equal(jobLocation('Hybrid','<p>Our global offices include Austin.</p>'),'Hybrid');assert.equal(jobLocation('Berlin','<h3>Available Locations: Austin, TX</h3>'),'Berlin');
});
test('location recovery handles double-escaped content and retains non-US eligibility review',()=>{
 assert.match(jobLocation('Hybrid','&amp;lt;p&amp;gt;Location: Austin, TX&amp;lt;/p&amp;gt;'),/Austin, TX/);
 const j=rank({id:'b',company:'fixture',title:'Senior Software Engineer',url:'https://example.invalid/b',location:'Hybrid',description:'<h3>Available Locations: Lisbon or London</h3>'});assert(j.flags?.includes('LOCATION_REVIEW'));
});
