'use strict';

// These are explicitly synthetic operating assumptions, never Cathay capacity/policy data.
const PROFILES = {
  'The Wing First': {name:'寰宇堂（頭等）',class:'頭等',capacity:20,occupancy:3,staff:3,minimum:2,ratio:8},
  'The Wing Business': {name:'寰宇堂（商務）',class:'商務',capacity:40,occupancy:6,staff:4,minimum:2,ratio:4},
  'The Pier First': {name:'玉衡堂（頭等）',class:'頭等',capacity:20,occupancy:2,staff:2,minimum:2,ratio:8},
  'The Pier Business': {name:'玉衡堂（商務）',class:'商務',capacity:40,occupancy:5,staff:4,minimum:2,ratio:3.5},
  'The Bridge': {name:'逸連堂（商務）',class:'商務',capacity:30,occupancy:4,staff:3,minimum:2,ratio:10},
  'The Deck': {name:'玲瓏堂（商務）',class:'商務',capacity:25,occupancy:2,staff:2,minimum:2,ratio:10},
};
const sum = xs => xs.reduce((a,b)=>a+b,0);
const time = t => Number(t.slice(0,2))*60+Number(t.slice(3,5));
const hours = [16,17,18,19];
function loungeView(row) {
  const profile=PROFILES[row.name];
  return {...row,lounge_id:row.lounge_id||row.id,display_name:profile?.name||row.name,travel_class:profile?.class||'未分類',profile:profile||{capacity:20,occupancy:0,staff:2,minimum:2,ratio:8}};
}
function aggregate({lounges,slots,reservations,waitlist,flights,date}) {
  const bySlot=new Map(slots.map(s=>[s.slot_id,s]));
  const confirmed=reservations.filter(r=>r.status==='confirmed' && bySlot.get(r.service_slot_id)?.service_date===date);
  const waiting=waitlist.filter(w=>w.status==='waiting');
  const offered=waitlist.filter(w=>w.status==='offered');
  // A visitor's multiple service bookings in a lounge form one visit, not multiple people.
  const visits=new Map();
  for (const r of confirmed) {
    const s=bySlot.get(r.service_slot_id),key=r.user_id+':'+s.lounge_id;
    const prior=visits.get(key),start=time(s.start_time)-15,end=time(s.end_time)+30;
    visits.set(key,{user:r.user_id,lounge:s.lounge_id,start:Math.min(prior?.start??Infinity,start),end:Math.max(prior?.end??0,end)});
  }
  const rows=lounges.map(l=>{
    const knownVisits=[...visits.values()].filter(v=>v.lounge===l.lounge_id);
    const additional=[];
    const associated=flights.filter(f=>f.loungeId===l.lounge_id);
    for (const flight of associated) {
      const at=(Date.parse(flight.estimatedAt)-Date.parse(date+'T00:00:00+08:00'))/60000;
      // Known booking visitors are removed from eligible cohort before applying probability.
      const assigned=knownVisits.filter(v=>flight.direction==='departure'?v.end<=at&&v.end>=at-210:v.start>=at&&v.start<=at+180).length;
      const n=Math.max(0,Math.round((flight.eligiblePassengers-assigned)*flight.visitProbability));
      additional.push({start:at+(flight.direction==='departure'?-120:30),end:at+(flight.direction==='departure'?-30:120),count:n});
    }
    const periods=hours.map(hour=>{
      const from=hour*60,to=from+60;
      const known=knownVisits.filter(v=>v.start>=from&&v.start<to).length;
      const temporary=sum(additional.filter(v=>v.start>=from&&v.start<to).map(v=>v.count));
      const demand=sum(additional.filter(v=>v.start<=from+30&&v.end>from+30).map(v=>v.count))+knownVisits.filter(v=>v.start<=from+30&&v.end>from+30).length;
      const occupancy=Math.min(l.profile.capacity,demand);
      const specialist=Math.max(0,...slots.filter(s=>s.lounge_id===l.lounge_id&&s.service_code==='massage'&&time(s.start_time)<to&&time(s.end_time)>from)
        .map(s=>confirmed.filter(r=>r.service_slot_id===s.slot_id).length));
      const required=Math.max(l.profile.minimum,Math.ceil(occupancy/l.profile.ratio)+specialist);
      return {hour,known,temporary,total:known+temporary,occupancy,overflow:Math.max(0,demand-occupancy),required,specialist};
    });
    return {loungeId:l.lounge_id,name:l.display_name,travelClass:l.travel_class,currentOccupancy:l.profile.occupancy,capacity:l.profile.capacity,currentStaff:l.profile.staff,periods};
  });
  const totals=hours.map((hour,i)=>({hour,known:sum(rows.map(r=>r.periods[i].known)),temporary:sum(rows.map(r=>r.periods[i].temporary)),total:sum(rows.map(r=>r.periods[i].total)),occupancy:sum(rows.map(r=>r.periods[i].occupancy)),required:sum(rows.map(r=>r.periods[i].required)),onDuty:sum(rows.map(r=>r.currentStaff))}));
  const peak=totals.reduce((a,b)=>b.total>a.total?b:a,{hour:16,total:0});
  const staffPeak=totals.reduce((a,b)=>b.required>a.required?b:a,{hour:16,required:0});
  const index=hours.indexOf(staffPeak.hour);
  const supply=rows.map(r=>({id:r.loungeId,name:r.name,left:Math.max(0,r.currentStaff-r.periods[index].required)}));
  const need=rows.map(r=>({id:r.loungeId,name:r.name,left:Math.max(0,r.periods[index].required-r.currentStaff)}));
  const transfers=[];
  // Only general lounge attendants are transferable. Specialist demand stays ring-fenced.
  for(const target of need)for(const source of supply){const count=Math.min(target.left,source.left);if(count){transfers.push({from:source.id,to:target.id,fromName:source.name,toName:target.name,count,role:'一般接待／場內支援'});target.left-=count;source.left-=count;}}
  return {rows,totals,peak,staffPeak,transfers,unfilled:sum(need.map(r=>r.left)),knownVisitors:new Set(confirmed.map(r=>r.user_id)).size,
    summary:{occupancy:sum(rows.map(r=>r.currentOccupancy)),confirmed:confirmed.length,waiting:new Set(waiting.map(w=>w.user_id)).size,waitingEntries:waiting.length,offered:offered.length,bookable:slots.filter(s=>s.active&&s.direct_bookable).length,rostered:sum(rows.map(r=>r.currentStaff))}};
}
module.exports={aggregate,loungeView,PROFILES,hours};
