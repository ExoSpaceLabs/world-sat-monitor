import {performance} from "node:perf_hooks";
import {buildGroupFeatureCollection} from "../app/components/groups/group-features.ts";

const sizes = [100, 1000, 5000, 10000];
const repeats = 20;
const maxP95Ms = Number(process.env.GROUP_FEATURE_P95_TARGET_MS ?? 100);
function makePositions(size) { return Array.from({length: size}, (_, index) => ({satellite:{id:index+1,name:`SAT-${index+1}`,active:true,norad_id:String(700000000+index),identifiers:{NORAD_CAT_ID:String(700000000+index)}},state_time:"2026-08-28T12:00:00Z",position:{lat_deg:(index%160)-80,lon_deg:((index*7)%360)-180,altitude_km:550+(index%30)},source:{run_id:"00000000-0000-0000-0000-000000000001",source_element_set_id:null}})); }
function percentile(values, fraction) { const ordered=[...values].sort((a,b)=>a-b); return ordered[Math.min(ordered.length-1,Math.round((ordered.length-1)*fraction))]; }
const results=[];
for (const size of sizes) {
  const positions=makePositions(size); buildGroupFeatureCollection(positions,""); const values=[]; let bytes=0;
  for (let iteration=0; iteration<repeats; iteration+=1) { const started=performance.now(); const collection=buildGroupFeatureCollection(positions,""); values.push(performance.now()-started); if(iteration===0) bytes=Buffer.byteLength(JSON.stringify(collection)); }
  const p95Ms=percentile(values,0.95); results.push({size,median_ms:Number(percentile(values,0.5).toFixed(3)),p95_ms:Number(p95Ms.toFixed(3)),geojson_bytes:bytes});
  if(size===10000 && p95Ms>maxP95Ms) throw new Error(`10k group feature transform p95 ${p95Ms.toFixed(1)} ms exceeded ${maxP95Ms} ms target`);
}
console.log(JSON.stringify({target_10k_p95_ms:maxP95Ms,results},null,2));
