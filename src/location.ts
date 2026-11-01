// Some Greenhouse boards expose a workplace type instead of the job's cities.
// Recover only explicit location-labelled text, never incidental office mentions.
export function jobLocation(location:string,description:string){
 if(!/^(?:hybrid|in[- ]office|on[- ]site|remote|unknown)$/i.test(location.trim()))return location;
 let text=description;
 for(let i=0;i<3;i++)text=text.replace(/&(lt|gt|amp|quot|apos|nbsp);|&#(\d+);|&#x([0-9a-f]+);/gi,(match,name,decimal,hex)=>{
  if(decimal||hex){const point=parseInt(decimal||hex,decimal?10:16);return point>=0&&point<=0x10ffff?String.fromCodePoint(point):match;}
  return ({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[name.toLowerCase()];
 });
 text=text.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<\/(?:h[1-6]|p|div)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ');
 const match=text.match(/(?:^|\n)\s*(?:available\s+)?locations?\s*[:|]\s*([^\n]{1,350})/i);
 const cities=match?.[1].replace(/\s+/g,' ').trim();return cities?`${cities} (${location})`:location;
}
