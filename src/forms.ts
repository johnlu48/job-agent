import type {Locator,Page} from 'playwright';
export const normalizeLabel=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[\s*]+/g,' ').trim().replace(/[?:]+$/,'').trim();
export async function controls(form:Locator){return form.locator('input,select,textarea').evaluateAll(els=>{
 els.forEach((el,i)=>el.setAttribute('data-agent-field',String(i)));
 return els.map(e=>{
  const c=e as HTMLInputElement;const labelled=(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');
  let mirrorOf:string|null=null;
  // React Select adds an anonymous required validation input beside its combobox.
  // Recognize only explicitly aria-hidden, non-focusable inputs with one sibling controller.
  if(e.getAttribute('aria-hidden')==='true'&&e.getAttribute('tabindex')==='-1'&&!e.id){
   const combos=e.parentElement?.querySelectorAll('[role="combobox"][data-agent-field]');
   if(combos?.length===1){mirrorOf=`[data-agent-field="${combos[0].getAttribute('data-agent-field')}"]`;e.setAttribute('data-agent-mirror-of',mirrorOf);}
  }
  return {selector:`[data-agent-field="${e.getAttribute('data-agent-field')}"]`,id:e.id,type:e.getAttribute('type')||'',tag:e.tagName,role:e.getAttribute('role'),disabled:c.disabled,required:c.required||e.getAttribute('aria-required')==='true',mirrorOf,label:e.getAttribute('aria-label')||Array.from(c.labels||[]).map(l=>l.textContent||'').join(' ')||labelled,context:e.closest('fieldset')?.textContent?.slice(0,2500)||e.parentElement?.parentElement?.textContent?.slice(0,2500)||'',options:e.tagName==='SELECT'?Array.from((e as HTMLSelectElement).options).map(o=>({value:o.value,text:o.text})):[]};
 });
});}
function optionKey(text:string){return normalizeLabel(text).replace(/\btx\b/g,'texas').replace(/\busa\b/g,'united states').replace(/\s*\(?\+1\)?$/,'').replace(/[,\s]+/g,' ').trim();}
export async function fillCombobox(page:Page,field:Locator,value:string){
 if(!value.trim())throw Error('Combobox answer cannot be empty');
 await field.click();if(await field.getAttribute('readonly')===null)await field.fill(value);
 let list=page.getByRole('listbox');const controlled=await field.getAttribute('aria-controls');
 if(controlled)list=page.locator(`[id=${JSON.stringify(controlled)}]`);
 await list.waitFor({state:'visible',timeout:10000});
 const options=list.getByRole('option');const texts=await options.allTextContents();
 const exact=texts.map((text,index)=>({text,index})).filter(o=>optionKey(o.text)===optionKey(value));
 if(exact.length!==1)throw Error(`No unique approved combobox option for ${await field.getAttribute('id')||'field'}`);
 const chosen=exact[0];await options.nth(chosen.index).click();
 await list.waitFor({state:'hidden',timeout:5000});
 const observed=await field.evaluate((el,label)=>{
  if((el as HTMLInputElement).value===label)return true;
  let root=el.parentElement;
  for(let depth=0;root&&root.tagName!=='FORM'&&depth<6;depth++,root=root.parentElement){
   const selected=root.querySelector('[class*="singleValue"],[class*="single-value"],[data-selected-value]');
   if(selected)return (selected.textContent||'').trim()===label.trim();
  }
  return false;
 },chosen.text);
 if(!observed)throw Error('Combobox selection could not be verified');
 await field.evaluate((el,label)=>el.setAttribute('data-agent-selected-label',label),chosen.text);
}
export async function validateRequired(form:Locator,approvedSelectors:string[]){
 return form.locator('input,select,textarea').evaluateAll((els,selectors)=>{
  const missing:string[]=[];
  for(const e of els){const c=e as HTMLInputElement;if(c.disabled||e.getAttribute('type')==='hidden')continue;
   const required=c.required||e.getAttribute('aria-required')==='true';const file=e.getAttribute('type')==='file';
   const mirror=e.getAttribute('data-agent-mirror-of');const approved=selectors.some(s=>e.matches(s));
   const selected=e.getAttribute('role')==='combobox'&&!!e.getAttribute('data-agent-selected-label');
   const approvedMirror=!!mirror&&selectors.includes(mirror);
   if(required&&!file&&!approved&&!approvedMirror){missing.push(e.id||e.getAttribute('name')||e.tagName);continue;}
   if(!c.checkValidity()&&!(selected&&c.validity.valueMissing)){missing.push(e.id||e.getAttribute('name')||e.tagName);continue;}
   if(required&&!selected&&e.getAttribute('aria-required')==='true'&&!c.value)missing.push(e.id||e.getAttribute('name')||e.tagName);
  }
  return [...new Set(missing)];
 },approvedSelectors);
}
