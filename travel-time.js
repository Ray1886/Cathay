(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LoungeTravelTimes=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  // 虚构的测试路线表，不代表香港机场实际距离或步行时间。
  const routes={wing:{'25':10,'31':15,'65':25,'6':5},pier:{'25':25,'31':20,'65':5,'6':30},deck:{'25':12,'31':17,'65':20,'6':3},bridge:{'25':15,'31':5,'65':20,'6':20}};
  const transfers={wing:{pier:20,deck:8,bridge:15},pier:{wing:20,deck:22,bridge:15},deck:{wing:8,pier:22,bridge:12},bridge:{wing:15,pier:15,deck:12}};
  function estimate(loungeId,gate){const key=String(gate).replace(/^G/i,'');const minutes=Object.hasOwn(routes,loungeId)?routes[loungeId][key]:undefined;return {source:'synthetic',loungeId,gate:String(gate),status:minutes===undefined?'unavailable':'estimated',minutes:minutes??null};}
  function transfer(from,to){return from===to?0:transfers[from]?.[to]??null;}
  return {estimate,transfer};
});
