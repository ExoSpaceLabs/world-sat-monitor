import assert from "node:assert/strict";
import test from "node:test";
import {buildGroupFeatureCollection} from "../app/components/groups/group-features.ts";

test("constellation markers stay in one WebGL GeoJSON collection", () => {
  const positions=Array.from({length:5000},(_,index)=>({satellite:{id:index+1,name:`SAT-${index}`,active:true,norad_id:String(700000000+index),identifiers:{NORAD_CAT_ID:String(700000000+index)}},state_time:"2026-08-28T12:00:00Z",position:{lat_deg:0,lon_deg:index%180,altitude_km:550},source:{run_id:"run",source_element_set_id:null}}));
  const collection=buildGroupFeatureCollection(positions,"700000123");
  assert.equal(collection.features.length,4999); assert.equal(collection.features[0].geometry.type,"Point"); assert.equal(collection.features[0].properties.active,true);
});
