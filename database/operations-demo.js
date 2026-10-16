'use strict';
const {withTransaction,openDatabase,DEFAULT_DATABASE_PATH}=require('../backend/db');
const {serviceDate}=require('../backend/reservation-rules');
const {seedDatabase}=require('./seed');
const {createReservationService}=require('../backend/reservation-service');

// Explicit, bounded scenario reset. All booking history/events and unrelated inventory survive.
function resetOperationsDemo(db,service,{date,confirmed=false}={}) {
  serviceDate(date);
  if(confirmed!==true)throw new Error('請明確確認重建示範時段 1001、1003、1004、1006。');
  const target=[1001,1003,1004,1006];
  const selected=target.map(id=>service.getSlotAvailability(id));
  if(selected.some(s=>s.service_date!==date))throw new Error('請選擇既有示範時段的日期；重建不會改寫其他日期。');
  // No asynchronous steps: another process cannot interleave between cancellation and reseeding.
  return withTransaction(db,()=>{
    const existing=db.prepare('SELECT id FROM users ORDER BY id').all();
    for(const u of existing)for(const w of service.getUserWaitlist(u.id))if(target.includes(w.service_slot_id)&&['waiting','offered'].includes(w.status))service.cancelWaitlistEntry(w.id,u.id);
    for(const u of existing)for(const r of service.getUserReservations(u.id,{status:'confirmed'}))if(target.includes(r.service_slot_id))service.cancelReservation(r.id,u.id);
    {
      for(const [id,name,tier]of [[5,'示範旅客陳先生','first'],[6,'示範旅客林小姐','diamond'],[7,'示範旅客王先生','first'],[8,'示範旅客李小姐','first']]){
        const old=db.prepare('SELECT * FROM users WHERE id=?').get(id);
        if(old&&(old.display_name!==name||old.membership_tier!==tier))throw new Error('示範旅客編號已被其他資料使用，未覆蓋。');
        db.prepare('INSERT OR IGNORE INTO users(id,display_name,membership_tier,created_at) VALUES (?,?,?,?)').run(id,name,tier,new Date().toISOString());
      }
      const bridge=db.prepare("SELECT id FROM lounges WHERE name='The Bridge'").get();
      if(!bridge){
        if(db.prepare('SELECT id FROM lounges WHERE id=6').get())throw new Error('逸連堂示範編號 6 已被使用。');
        db.prepare("INSERT INTO lounges VALUES (6,'The Bridge','Synthetic HK Terminal 1','06:00','23:30',1)").run();
      } else if(bridge.id!==6)throw new Error('現有逸連堂編號不同，請先調整示範映射。');
    }
    for(const id of target)service.updateServiceSlot(id,{active:true,capacity:id===1003?2:1});
    const version=db.prepare('SELECT coalesce(max(id),0)+1 AS n FROM reservation_events').get().n;
    service.createReservation(5,1001,'ops-demo:'+version+':holder');
    service.joinWaitlist(2,1001);service.joinWaitlist(1,1001);service.joinWaitlist(6,1001);
    service.createReservation(2,1003,'ops-demo:'+version+':shower-b');
    service.createReservation(6,1003,'ops-demo:'+version+':shower-c');
    service.createReservation(7,1004,'ops-demo:'+version+':rest');
    const held=service.createReservation(8,1006,'ops-demo:'+version+':offer-owner');
    service.joinWaitlist(7,1006);service.cancelReservation(held.id,8);
    return {slotId:1001,selectedPassenger:1,position:service.getWaitlistPosition(1,1001).position,resetSlots:target};
  });
}
if(require.main===module){
  if(!process.argv.includes('--confirm')){console.error('請先停止服務，再執行 npm run demo:ops:reset -- --confirm；保留歷史，僅重建指定示範時段。');process.exitCode=1;}
  else {const db=openDatabase({filename:DEFAULT_DATABASE_PATH});try{const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong'}).format(new Date());seedDatabase(db,{date});const chosen=db.prepare('SELECT service_date FROM service_slots WHERE id=1001').get().service_date;console.log(resetOperationsDemo(db,createReservationService({db}),{date:chosen,confirmed:true}));}finally{db.close();}}
}
module.exports={resetOperationsDemo};
