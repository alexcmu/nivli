import { linkedInstruction } from "./conversation.js";
import type { AgentInput, Proposal } from "./pi-adapter.js";
const local = (instant: Date, zone: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(instant)
    .replace(" ", "T");
export function validateProposal(p: Proposal, i: AgentInput): boolean {
  const linked = linkedInstruction(i);
  if (
    linked &&
    p?.instruction === i.text &&
    i.text.includes(p.timeExpression)
  ) {
    const effective = {
      ...i,
      text: linked.text,
      now: linked.now,
      context: undefined,
    };
    return validateProposal(
      { ...p, instruction: linked.text, timeExpression: linked.text },
      effective,
    );
  }
  if (
    !p ||
    typeof p !== "object" ||
    Object.keys(p).some(
      (k) =>
        ![
          "title",
          "instant",
          "timeZone",
          "instruction",
          "timeExpression",
          "localDateTime",
          "deadlineDate",
          "deadlineExpression",
        ].includes(k),
    )
  )
    return false;
  if (
    ![
      p.title,
      p.instant,
      p.timeZone,
      p.instruction,
      p.timeExpression,
      p.localDateTime,
    ].every((v) => typeof v === "string" && v.length > 0) ||
    p.title.trim().length < 1 ||
    p.title.length > 300 ||
    p.timeZone !== i.timeZone ||
    p.instruction !== i.text ||
    !i.text.includes(p.timeExpression)
  )
    return false;
  if (
    !/(提醒我|提醒一下|帮我.{0,10}提醒|设置.{0,8}提醒|记得提醒|remind me|set.{0,12}reminder)/i.test(
      i.text,
    ) ||
    /(希望|要是|如果|也许|想有空|不.{0,3}提醒|不要|wish|maybe|don't|do not)/i.test(
      i.text,
    )
  )
    return false;
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      p.instant,
    )
  )
    return false;
  const instant = new Date(p.instant),
    now = new Date(i.now);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant <= now ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(p.localDateTime)
  )
    return false;
  if (local(instant, i.timeZone) !== p.localDateTime) return false;
  // Reject either occurrence of a repeated wall clock at DST fallback.
  for (let delta = -180; delta <= 180; delta += 15)
    if (
      delta &&
      local(new Date(instant.getTime() + delta * 60000), i.timeZone) ===
        p.localDateTime
    )
      return false;
  const today = local(now, i.timeZone).slice(0, 10),
    date = p.localDateTime.slice(0, 10),
    e = p.timeExpression;
  let expected: string | undefined;
  const absolute = e.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/);
  if (absolute)
    expected = `${absolute[1]}-${absolute[2]!.padStart(2, "0")}-${absolute[3]!.padStart(2, "0")}`;
  else {
    const days = /后天/.test(e)
      ? 2
      : /明天|tomorrow/i.test(e)
        ? 1
        : /今天|today/i.test(e)
          ? 0
          : undefined;
    if (days !== undefined)
      expected = new Date(Date.parse(today + "T00:00:00Z") + days * 86400000)
        .toISOString()
        .slice(0, 10);
  }
  if (!expected || date !== expected) return false;
  const clockText = e.replace(/[零一二三四五六七八九十两]+(?=[点时])/g, (n) => {
    const digits = "零一二三四五六七八九";
    if (n === "两") return "2";
    if (n.includes("十")) {
      const [a, b] = n.split("十");
      return String(
        (a ? digits.indexOf(a) : 1) * 10 + (b ? digits.indexOf(b) : 0),
      );
    }
    return String(digits.indexOf(n));
  });
  const clock = clockText.match(/(\d{1,2})[:：点时](?:(\d{1,2})分?)?/);
  if (!clock) return false;
  let hour = Number(clock[1]),
    minute = Number(clock[2] ?? (/半/.test(e) ? 30 : 0));
  if (/下午|晚上|pm/i.test(e) && hour < 12) hour += 12;
  if (/上午|早上|am/i.test(e) && hour === 12) hour = 0;
  if (
    hour > 23 ||
    minute > 59 ||
    p.localDateTime.slice(11, 16) !==
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  )
    return false;
  if (p.deadlineDate !== undefined) {
    if (
      typeof p.deadlineDate !== "string" ||
      typeof p.deadlineExpression !== "string" ||
      !i.text.includes(p.deadlineExpression) ||
      !p.deadlineExpression.includes(p.deadlineDate) ||
      !/\d{4}-\d\d-\d\d/.test(p.deadlineDate) ||
      new Date(p.deadlineDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        p.deadlineDate
    )
      return false;
  }
  return true;
}
