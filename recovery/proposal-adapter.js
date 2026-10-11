'use strict';
const existing = require('../itinerary.js');
const {date,displayTime} = require('./time');
// 现有 Agent 的校验只支持同日 HH:MM 和固定 10 分钟 gate 活动。
function toAgentProposal(result,currentActivities,context) {
  if(result.type!=='itinerary_proposal') return {compatible:false,reasons:['结果不是行程修改提案']};
  if(result.draft.some(item=>item.startAt.slice(17,19)!=='00'||item.endAt.slice(17,19)!=='00')) return {compatible:false,reasons:['秒级时间不能无损转换为现有 HH:MM 格式']};
  const operations=result.operations.map(({startAt,endAt,...operation})=>({...operation,...(startAt?{startAt,start:displayTime(startAt)}:{}),...(endAt?{endAt,end:displayTime(endAt)}:{})}));
  try {
    const draft=existing.applyProposalToDraft(currentActivities,operations,context);
    const checked=existing.validateItinerary(draft,{...context,originalActivities:currentActivities});
    if(!checked.valid) return {compatible:false,reasons:checked.errors};
    return {compatible:true,proposal:{type:'itinerary_proposal',explanation:result.explanation,operations,warnings:[...new Set([...result.warnings,...checked.warnings])]},baseRevision:result.baseRevision,baseSignature:result.baseSignature};
  } catch(error) {return {compatible:false,reasons:[error.message]};}
}
module.exports = {toAgentProposal};
