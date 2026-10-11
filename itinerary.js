(function(root,factory){
  const engine=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;
  if(root)root.ItineraryEngine=engine;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const LOCATIONS={
    wing:{name:'寰宇堂頭等貴賓室',shortName:'寰宇堂',address:'一號客運大樓 7 樓，鄰近 1 至 4 號登機閘口',referenceGate:2,access:'頭等艙及合資格會員',facilities:['淋浴','晚餐','按摩','休息區','工作'],areas:{shower:'淋浴間',dining:'饌薈廳',massage:'悠然軒',rest:'恬逸閣',work:'閱覽間'},url:'https://www.cathaypacific.com/cx/zh_TW/destinations/lounges/hong-kong-hkg/the-wing-first.html'},
    pier:{name:'玉衡堂頭等貴賓室',shortName:'玉衡堂',address:'一號客運大樓 6 樓，鄰近 63 號登機閘口',referenceGate:63,access:'頭等艙及合資格會員',facilities:['淋浴','晚餐','按摩','休息區','工作'],areas:{shower:'淋浴間',dining:'饌薈廳',massage:'按摩服務',rest:'恬逸間',work:'閱覽間'},url:'https://www.cathaypacific.com/cx/zh_TW/destinations/lounges/hong-kong-hkg/the-pier-first.html'},
    deck:{name:'玲瓏堂',shortName:'玲瓏堂',address:'一號客運大樓 7 樓，鄰近 6 號登機閘口',referenceGate:6,access:'商務艙及合資格會員',facilities:['淋浴','晚餐','休息區','工作'],areas:{shower:'淋浴室',dining:'風味坊',rest:'貴賓室主廳',work:'工作空間'},url:'https://www.cathaypacific.com/cx/zh_HK/destinations/lounges/hong-kong-hkg/the-deck.html'},
    bridge:{name:'逸連堂',shortName:'逸連堂',address:'一號客運大樓 6 樓，鄰近 35 號登機閘口',referenceGate:35,access:'商務艙及合資格會員',facilities:['淋浴','晚餐','休息區','工作'],areas:{shower:'淋浴室',dining:'風味坊',rest:'專屬空間',work:'工作空間'},url:'https://www.cathaypacific.com/cx/zh_TW/destinations/lounges/hong-kong-hkg/the-bridge.html'}
  };
  const SERVICES={
    shower:{label:'淋浴',locationId:'wing',locations:['wing','pier','deck','bridge'],area:'淋浴間',venue:LOCATIONS.wing.name,duration:30,reservationRequired:true},
    dining:{label:'晚餐',locationId:'wing',locations:['wing','pier','deck','bridge'],area:'饌薈廳',venue:LOCATIONS.wing.name,duration:30,reservationRequired:false},
    massage:{label:'按摩',locationId:'wing',locations:['wing','pier'],area:'悠然軒',venue:LOCATIONS.wing.name,duration:15,reservationRequired:true},
    rest:{label:'休息區',locationId:'deck',locations:['wing','pier','deck','bridge'],area:'貴賓室主廳',venue:LOCATIONS.deck.name,duration:20,reservationRequired:false},
    work:{label:'工作',locationId:'wing',locations:['wing','pier','deck','bridge'],area:'閱覽間',venue:LOCATIONS.wing.name,duration:20,reservationRequired:false},
    gate:{label:'前往登機口',locationId:'gate',area:'登機閘口',venue:'步行約 10 分鐘',duration:10}
  };
  const DEMO_AVAILABILITY={source:'demo',slots:[
    {type:'shower',locationId:'wing',start:'17:00',available:1,queue:0},
    {type:'shower',locationId:'pier',start:'17:30',available:0,queue:1},
    {type:'shower',locationId:'deck',start:'18:00',available:1,queue:0},
    {type:'shower',locationId:'bridge',start:'18:30',available:0,queue:2},
    {type:'massage',locationId:'wing',start:'18:00',available:1,queue:0},
    {type:'massage',locationId:'wing',start:'18:40',available:0,queue:2},
    {type:'massage',locationId:'pier',start:'18:30',available:0,queue:1}
  ]};
  const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const mins=value=>TIME.test(value||'')?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
  const fmt=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const clone=items=>items.map(item=>({...item}));
  const fail=message=>{throw new Error(message)};
  function resolveServiceLocation(type,locationId){
    const service=SERVICES[type];
    if(!service||type==='gate')return {locationId:'gate',venue:SERVICES.gate.venue,area:SERVICES.gate.area};
    const selected=service.locations.includes(locationId)?locationId:service.locationId;
    const location=LOCATIONS[selected];
    return {locationId:selected,venue:location.name,area:location.areas[type]||service.area};
  }

  function applyProposalToDraft(currentActivities,operations){
    if(!Array.isArray(currentActivities)||!Array.isArray(operations)||!operations.length||operations.length>12)fail('修改項目無效或數量過多。');
    const draft=clone(currentActivities);
    const originalIds=new Set(draft.map(item=>item.id));
    const touched=new Set();
    let nextId=Math.max(0,...draft.map(item=>Number.isInteger(item.id)?item.id:0))+1;
    for(const operation of operations){
      if(!operation||!['add','update','remove'].includes(operation.op))fail('未知的行程修改類型。');
      if(operation.op==='add'){
        const type=operation.type;
        if(!SERVICES[type]||type==='gate')fail('不能添加未知活動或重複的登機口行程。');
        if(!TIME.test(operation.start||'')||!TIME.test(operation.end||''))fail('新增活動需要有效的開始和結束時間。');
        const location=resolveServiceLocation(type,operation.locationId);
        draft.push({id:nextId++,type,start:operation.start,end:operation.end,...location,status:SERVICES[type].reservationRequired?'pending':'added'});
        continue;
      }
      const id=operation.id;
      if(!Number.isInteger(id)||!originalIds.has(id))fail('找不到要修改的活動 ID。');
      if(touched.has(id))fail('同一活動不能重複修改。');
      touched.add(id);
      const index=draft.findIndex(item=>item.id===id);
      if(index<0)fail('找不到要修改的活動。');
      const previous=draft[index];
      if(operation.op==='remove'){
        if(previous.type==='gate')fail('登機口行程不能移除。');
        draft.splice(index,1);
        continue;
      }
      const type=operation.type||previous.type;
      if(!SERVICES[type]||((previous.type==='gate')!==(type==='gate')))fail('活動類型無效，不能更改登機口行程的類型。');
      const start=operation.start||previous.start;
      const end=operation.end||(operation.start||type!==previous.type?fmt(mins(start)+SERVICES[type].duration):previous.end);
      if(!TIME.test(start)||!TIME.test(end))fail('活動時間格式無效。');
      const location=resolveServiceLocation(type,operation.locationId||(type===previous.type?previous.locationId:null));
      const changed=type!==previous.type||start!==previous.start||end!==previous.end||location.locationId!==previous.locationId;
      draft[index]={...previous,type,start,end,...location,status:changed&&previous.status==='confirmed'?'pending':previous.status};
    }
    return draft;
  }

  function validateItinerary(draft,context={}){
    const errors=[],warnings=[];
    if(!Array.isArray(draft))return {valid:false,errors:['行程格式無效。'],warnings};
    const seen=new Set();
    const windowStart=mins(context.windowStart||'17:30');
    const windowEnd=mins(context.windowEnd||'19:15');
    const boarding=mins(context.boardingTime||'19:20');
    const buffer=Number.isInteger(context.boardingBuffer)?context.boardingBuffer:10;
    for(const item of draft){
      if(!Number.isInteger(item.id)||seen.has(item.id))errors.push('活動 ID 重複或無效。');
      seen.add(item.id);
      const service=SERVICES[item.type];
      if(!service){errors.push('行程包含未知活動。');continue}
      if(!TIME.test(item.start||'')||!TIME.test(item.end||'')){errors.push(service.label+' 的時間格式無效。');continue}
      const start=mins(item.start),end=mins(item.end);
      if(end<=start)errors.push(service.label+' 的結束時間必須晚於開始時間。');
      if(end-start!==service.duration)errors.push(service.label+' 需安排 '+service.duration+' 分鐘。');
      if(start<windowStart||end>windowEnd)errors.push(service.label+' 超出可用貴賓室時段。');
      if(item.type!=='gate'){
        const inferredLocationId=item.locationId||service.locations.find(id=>LOCATIONS[id].name===item.venue)||service.locationId;
        const location=LOCATIONS[inferredLocationId];
        if(!location||!service.locations.includes(inferredLocationId))errors.push(service.label+' 的地點代碼不符。');
        else if(item.venue!==location.name)errors.push(service.label+' 的服務地點不符。');
      }else if(item.venue!==service.venue)errors.push(service.label+' 的服務地點不符。');
      if(!['added','pending','confirmed','none'].includes(item.status))errors.push(service.label+' 的預約狀態無效。');
    }
    const gates=draft.filter(item=>item.type==='gate');
    if(gates.length!==1)errors.push('行程必須保留一項前往登機口活動。');
    if(gates.length===1&&TIME.test(gates[0].end||'')&&mins(gates[0].end)>boarding-buffer)errors.push('抵達登機口時間不足登機前緩衝。');
    const ordered=[...draft].filter(item=>TIME.test(item.start||'')&&TIME.test(item.end||'')).sort((a,b)=>mins(a.start)-mins(b.start));
    for(let index=1;index<ordered.length;index++)if(mins(ordered[index].start)<mins(ordered[index-1].end))errors.push(ordered[index-1].start+' 與 '+ordered[index].start+' 的活動時間重疊。');
    if(gates.length===1&&TIME.test(gates[0].start||''))for(const item of draft){
      if(item.type!=='gate'&&TIME.test(item.end||'')&&mins(item.end)>mins(gates[0].start))errors.push('活動必須在前往登機口前結束。');
    }
    const original=Array.isArray(context.originalActivities)?context.originalActivities:[];
    for(const previous of original.filter(item=>item.status==='confirmed')){
      const next=draft.find(item=>item.id===previous.id);
      if(!next)warnings.push(previous.start+' '+SERVICES[previous.type]?.label+' 已從行程移除，但實際預約不會自動取消。');
      else if(next.start!==previous.start||next.end!==previous.end||next.type!==previous.type||next.locationId!==previous.locationId)warnings.push(previous.start+' '+SERVICES[previous.type]?.label+' 時段或地點已變更，需要重新確認預約。');
    }
    return {valid:errors.length===0,errors:[...new Set(errors)],warnings};
  }

  function diffItineraries(original,draft){
    const before=new Map(original.map(item=>[item.id,item]));
    const after=new Map(draft.map(item=>[item.id,item]));
    const changes=[];
    for(const item of original){
      const next=after.get(item.id);
      if(!next)changes.push({kind:'removed',before:{...item}});
      else if(['type','start','end','locationId','venue','status'].some(key=>item[key]!==next[key]))changes.push({kind:'updated',before:{...item},after:{...next}});
    }
    for(const item of draft)if(!before.has(item.id))changes.push({kind:'added',after:{...item}});
    return changes;
  }
  function itinerarySignature(items,context={}){
    return JSON.stringify({activities:items.map(item=>({id:item.id,type:item.type,start:item.start,end:item.end,locationId:item.locationId,venue:item.venue,status:item.status})),gate:context.gate,boardingTime:context.boardingTime,windowStart:context.windowStart});
  }
  return {LOCATIONS,SERVICES,DEMO_AVAILABILITY,resolveServiceLocation,applyProposalToDraft,validateItinerary,diffItineraries,itinerarySignature};
});
