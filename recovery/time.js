'use strict';
const MINUTE = 60000;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function epoch(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !TIME.test(match[2]) || Number(match[3]) > 59) throw new Error('需要有效、含时区的 ISO 时间戳');
  const zone = match[4];
  if (zone !== 'Z' && (Number(zone.slice(1,3)) > 14 || Number(zone.slice(4)) > 59 || (Number(zone.slice(1,3)) === 14 && Number(zone.slice(4)) !== 0))) throw new Error('时区偏移无效');
  const offset = zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1,3))*60 + Number(zone.slice(4)));
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result + offset*MINUTE).toISOString().slice(0,19) !== value.slice(0,19)) throw new Error('日期无效');
  return result;
}
function iso(value) { return new Date(value + 480*MINUTE).toISOString().slice(0,19) + '+08:00'; }
function date(value) { return iso(epoch(value)).slice(0,10); }
function displayTime(value) { return iso(epoch(value)).slice(11,16); }
function atDate(day, time) {
  if (!TIME.test(time)) throw new Error('时间必须是 HH:MM');
  const value = day + 'T' + time + ':00+08:00'; epoch(value); return value;
}
function normalizeActivities(items, anchor) {
  if (!Array.isArray(items)) throw new Error('行程必须是数组');
  const ids = new Set();
  let day = date(anchor), previous = -Infinity;
  return items.map(item => {
    if (!Number.isInteger(item.id) || ids.has(item.id)) throw new Error('活动 ID 必须是唯一整数');
    ids.add(item.id);
    let startAt = item.startAt, endAt = item.endAt;
    if (!startAt) {
      startAt = atDate(day, item.start);
      if (previous-epoch(startAt)>720*MINUTE) { day = date(iso(epoch(startAt) + 1440*MINUTE)); startAt = atDate(day,item.start); }
    }
    if (!endAt) {
      endAt = atDate(date(startAt),item.end);
      if (epoch(endAt) < epoch(startAt)) endAt = iso(epoch(endAt) + 1440*MINUTE);
    }
    epoch(startAt); epoch(endAt); previous = epoch(startAt);
    return {...structuredClone(item),startAt:iso(epoch(startAt)),endAt:iso(epoch(endAt))};
  });
}
module.exports = { MINUTE, TIME, epoch, iso, date, displayTime, atDate, normalizeActivities };
