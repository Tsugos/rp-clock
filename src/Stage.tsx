import {ReactElement} from 'react';
import {StageBase, StageResponse, InitialData, Message} from '@chub-ai/stages-ts';
import {LoadResponse} from '@chub-ai/stages-ts/dist/types/load';

type Clock = {date: string; minute: number};
type State = {clock: Clock};
type Config = {initial_date?: string; initial_time?: string; show_timestamp?: boolean};
const pad = (n: number) => String(n).padStart(2, '0');
function days(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || +m[1] < 1) return null;
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
    ? Math.floor(d.getTime() / 86400000) : null;
}
const isoAt = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const valid = (c: any): c is Clock => typeof c?.date === 'string' && days(c.date) !== null &&
  Number.isSafeInteger(c.minute) && c.minute >= 0 && c.minute < 1440;
const parseTime = (s?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : 1080;
};
const display = (c: Clock) => {
  const [year, month, day] = c.date.split('-');
  return `${day}.${month}.${year}\n${pad(Math.floor(c.minute / 60))}:${pad(c.minute % 60)}`;
};
const add = (c: Clock, n: number): Clock => ({
  date: isoAt(days(c.date)! + Math.floor((c.minute + n) / 1440)), minute: (c.minute + n) % 1440
});
function parseStamp(s: string): Clock | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const c = {date: `${m[3]}-${m[2]}-${m[1]}`, minute: +m[4] * 60 + +m[5]};
  return valid(c) ? c : null;
}
export function playerClock(c: Clock, text: string): Clock {
  const absolute = /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/.exec(text);
  if (absolute) {const next = parseStamp(absolute[0]); if (next) return next;}
  if (/(?:на\s+)?следующ(?:ее|им)\s+утр(?:о|ом)|next\s+morning/i.test(text))
    return days(c.date)! < days('9999-12-31')! ? add({date: c.date, minute: 480}, 1440) : c;
  const r = /(?:через|спустя|after|in)\s+(\d{1,4}|один|одну|два|две|три|четыре|пять|десять|двадцать)\s*(час(?:а|ов)?|минут(?:у|ы)?|hours?|minutes?|hrs?|mins?)(?=$|[\s.,!?;:])/i.exec(text);
  if (!r) return c;
  const words: Record<string, number> = {один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, десять: 10, двадцать: 20};
  const n = (words[r[1].toLowerCase()] ?? +r[1]) * (/^(час|hour|hr)/i.test(r[2]) ? 60 : 1);
  return n > 0 && n <= 43200 && days(c.date)! + Math.floor((c.minute + n) / 1440) <= days('9999-12-31')!
    ? add(c, n) : c;
}
export function botClock(c: Clock, text: string): Clock {
  const updates = [...text.matchAll(/\[RPG_TIME_UPDATE\]([\s\S]*?)\[\/RPG_TIME_UPDATE\]/gi)];
  if (updates.length !== 1) return c;
  const next = parseStamp(updates[0][1].trim());
  if (!next) return c;
  const delta = (days(next.date)! - days(c.date)!) * 1440 + next.minute - c.minute;
  return delta >= 0 && delta <= 1440 ? next : c;
}
export function visibleText(text: string, c: Clock, show: boolean): string {
  const clean = text.replace(/\[RPG_TIME_UPDATE\][\s\S]*?\[\/RPG_TIME_UPDATE\]/gi, '')
    .replace(/\[RPG_TIME_UPDATE\][\s\S]*$/gi, '')
    .replace(/\[\/RPG_TIME_UPDATE\]/gi, '')
    .replace(/^\s*(?:(?:\d{2}\.\d{2}\.\d{4}\s*\n\s*\d{2}:\d{2}|Day\s+\d+\s*,\s*\d{1,2}:\d{2})\s*\n)+/i, '').trim();
  return show ? `${display(c)}\n\n${clean}` : clean;
}
export class Stage extends StageBase<null, null, State, Config> {
  private clock: Clock;
  private readonly initial: Clock;
  private readonly show: boolean;
  constructor(data: InitialData<null, null, State, Config>) {
    super(data);
    const candidate = {date: data.config?.initial_date ?? '2026-02-02', minute: parseTime(data.config?.initial_time)};
    this.initial = valid(candidate) ? candidate : {date: '2026-02-02', minute: 1080};
    this.clock = valid(data.messageState?.clock) ? {...data.messageState.clock} : {...this.initial};
    this.show = data.config?.show_timestamp !== false;
  }
  async load(): Promise<Partial<LoadResponse<null, null, State>>> {
    return {success: true, initState: null, chatState: null};
  }
  async setState(state: State): Promise<void> {
    this.clock = valid(state?.clock) ? {...state.clock} : {...this.initial};
  }
  async beforePrompt(message: Message): Promise<Partial<StageResponse<null, State>>> {
    if (!message.isBot) this.clock = playerClock(this.clock, message.content || '');
    return {
      messageState: {clock: {...this.clock}},
      stageDirections: `RP date and time: ${display(this.clock).replace('\n', ' ')}. Preserve chronology. Only if time passes within your response, append [RPG_TIME_UPDATE]DD.MM.YYYY HH:MM[/RPG_TIME_UPDATE] at the end with the new date and time (up to 24 hours later); otherwise omit it. Never print a visible timestamp yourself: the stage handles it. Do not alter character, memory, relationships, story facts or other stages.`,
      modifiedMessage: null, systemMessage: null, chatState: null
    };
  }
  async afterResponse(message: Message): Promise<Partial<StageResponse<null, State>>> {
    this.clock = botClock(this.clock, message.content || '');
    return {messageState: {clock: {...this.clock}}, modifiedMessage: visibleText(message.content || '', this.clock, this.show), systemMessage: null, chatState: null};
  }
  render(): ReactElement { return <></>; }
}
