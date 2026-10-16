'use strict';
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {verifyLocalRequest,readBody,allowedObject,queryObject}=require('./reservation-api');
const {serviceDate,positiveId,ReservationError}=require('./reservation-rules');
const {resetOperationsDemo}=require('../database/operations-demo');

function createOperationsApi({operations,service,db,accessToken=randomBytes(24).toString('hex'),clock=()=>Date.now()}) {
  const sessions=new Map();let entryUsed=false;
  const send=(res,status,data,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(data));};
  const fail=(code,message,status=400)=>{throw new ReservationError(code,message,status);};
  async function handler(req,res){
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/ops/'))return false;
    try {
      verifyLocalRequest(req);
      const write=!['GET','HEAD'].includes(req.method);
      if(write&&(req.headers.origin!=='http://'+req.headers.host||req.headers['x-ops-request']!=='1'))fail('OPS_ORIGIN','請由同源營運介面操作。',403);
      if(url.pathname==='/api/ops/session'&&req.method==='POST'){
        const body=allowedObject(await readBody(req),['token']);
        const a=Buffer.from(String(body.token||'')),b=Buffer.from(accessToken);
        if(entryUsed||a.length!==b.length||!timingSafeEqual(a,b))fail('OPS_AUTH','營運入口無效或已使用，請從啟動終端取得新的入口。',401);
        entryUsed=true;const session=randomBytes(32).toString('hex');sessions.set(session,clock()+8*3600000);
        send(res,200,{data:{authorised:true}},{'Set-Cookie':`cathay_ops=${session}; HttpOnly; SameSite=Strict; Path=/api/ops; Max-Age=28800`});return true;
      }
      for(const [key,expires]of sessions)if(expires<=clock())sessions.delete(key);
      const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cathay_ops='))?.slice(11);
      if(!cookie||!sessions.has(cookie))fail('OPS_AUTH','請使用服務啟動時提供的一次性營運入口。',401);
      let data;
      if(url.pathname==='/api/ops/state'&&req.method==='GET'){
        const query=queryObject(url,['date']);data=operations.snapshot(serviceDate(query.date));
      }else if(url.pathname==='/api/ops/actions'&&req.method==='POST'){
        const body=await readBody(req),fields={book:['userId','slotId','idempotencyKey'],cancel:['userId','reservationId'],join:['userId','slotId'],leave:['userId','entryId'],accept:['userId','entryId'],offer:['slotId']};
        if(!fields[body.action])fail('INVALID_INPUT','未知預約操作。');
        allowedObject(body,['action',...fields[body.action]]);data=operations.action(body.action,body);
      }else if(url.pathname==='/api/ops/slots'&&req.method==='POST'){
        data=service.createServiceSlot(allowedObject(await readBody(req),['loungeServiceId','date','start','end','capacity']));
      }else if(/^\/api\/ops\/slots\/\d+$/.test(url.pathname)&&['PATCH','DELETE'].includes(req.method)){
        const id=positiveId(Number(url.pathname.split('/').at(-1)));
        data=req.method==='DELETE'?service.removeServiceSlot(id):service.updateServiceSlot(id,allowedObject(await readBody(req),['capacity','active']));
      }else if(url.pathname==='/api/ops/scenario'&&req.method==='POST'){
        const body=allowedObject(await readBody(req),['date','confirmed']);
        data=resetOperationsDemo(db,service,body);operations.resetFlights();
      }else if(url.pathname==='/api/ops/flights'&&req.method==='POST'){
        const body=allowedObject(await readBody(req),['date','number','minutes']);data=operations.delayFlight(body.date,body.number,body.minutes);
      }else fail('NOT_FOUND','找不到此營運路由或方法。',404);
      send(res,200,{data});
    }catch(error){send(res,error.status||400,{error:{code:error.code||'OPS_ERROR',message:error.status?error.message:'操作未完成，請核對示範資料及所選日期。'}});}
    return true;
  }
  return {handler,accessToken};
}
module.exports={createOperationsApi};
