import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function todayUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string) {
  if (dateStr === todayUTC()) return "TODAY";
  const d = new Date(`${dateStr}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

/* ================= daily prompt ================= */

const DAILY_PROMPTS = [
  "If you could mass-produce one invention overnight, what would it be?",
  "Roll the dice: pick a skill you'd learn if it only took 24 hours.",
  "You wake up with a superpower tomorrow — what did you pick?",
  "Dare yourself: what's one wild thing you'd do if nobody judged you?",
  "Flip a coin — heads you start something new, tails you finish something old. Which is it?",
  "If your life had a theme song today, what genre would it be?",
  "Random challenge: compliment a stranger, try a new food, or sketch something ugly. Pick one.",
  "You get one free re-roll on any decision you made this year. Which one?",
  "Spin the wheel: what's a place you'd teleport to right now?",
  "If you could swap lives with anyone for a day, who and why?",
  "Lucky draw: name one thing you'd put in a time capsule for 2035.",
  "Wildcard: what's an opinion you hold that would surprise people?",
  "Double or nothing — what risk would you take if success was guaranteed?",
  "Roll again: what's something weird you secretly want to try?",
  "Jackpot question: if money didn't exist, what would you do all day?",
];

/* Same prompt for every visitor, all day — derived from the UTC date, not random per-load. */
function promptForDate(dateStr: string): string {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  return DAILY_PROMPTS[hash % DAILY_PROMPTS.length];
}

function nextUtcMidnightISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/* Tiny synthesized "boop" — no audio file needed. */
function playPop() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    // audio not available — silently skip
  }
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tomorrow, Maybe — a chat with your future self" },
      {
        name: "description",
        content: "Write a few lines to your future self. Tomorrow, read them back — and reply.",
      },
      { property: "og:title", content: "Tomorrow, Maybe" },
      {
        property: "og:description",
        content: "A slow, private conversation between you and tomorrow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

type LetterRow = {
  id: string;
  user_id: string;
  letter_date: string;
  goal: string | null;
  thought: string | null;
  advice: string | null;
  color: string;
  unlock_at: string;
  profiles?: { username: string | null } | null;
};

type ReactionRow = {
  letter_id: string;
  emoji: string;
  user_id: string;
};

const REACTION_EMOJI = ["❤", "☹", "✷", "☺", "✺", "✖"];

function parseMessages(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
      }
    } catch {
      // not JSON — treat as a single plain-text message
    }
  }
  return [raw];
}

function messagesOf(letter: LetterRow): string[] {
  const fromThought = parseMessages(letter.thought);
  if (fromThought.length) return fromThought;
  const legacy = [letter.goal, letter.advice].filter(Boolean).join(" ");
  return legacy ? [legacy] : [];
}

function nameOf(letter: LetterRow): string {
  return letter.profiles?.username?.trim() || "anon";
}

/* ================= pixel envelopes ================= */

function PadlockSVG() {
  return (
    <g shapeRendering="crispEdges">
      <path d="M27 5 L27 2 L35 2 L35 5" fill="none" stroke="#9aa0ab" strokeWidth="2.6" />
      <rect x="25" y="5" width="12" height="11" fill="#e7b53c" stroke="#141414" strokeWidth="1.4" />
      <rect x="25.7" y="5.7" width="10.6" height="3" fill="#f2d574" />
      <rect x="30" y="9" width="2" height="4.5" fill="#141414" />
    </g>
  );
}

function BadgeSVG({ label = "1" }: { label?: string }) {
  return (
    <g className="badge-wiggle" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
      <circle cx="33" cy="6" r="7" fill="#c0455a" stroke="#141414" strokeWidth="1.4" />
      <circle cx="30.5" cy="4" r="1.6" fill="#d98090" />
      <text
        x="33"
        y="6"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-mono)"
        fontWeight="700"
        fontSize="8"
        fill="#fff"
      >
        {label}
      </text>
    </g>
  );
}

function HeartSVG() {
  return (
    <g shapeRendering="crispEdges">
      <polygon
        points="20,16 17,13.5 14,13.5 12.5,16 14,19.5 20,25 26,19.5 27.5,16 26,13.5 23,13.5"
        fill="#b23a52"
        stroke="#141414"
        strokeWidth="1.4"
      />
      <polygon points="20,16.5 17.5,14.5 15,14.5 14,16.5 16,19 20,22" fill="#c8617a" />
    </g>
  );
}

function PinSVG() {
  return (
    <g shapeRendering="crispEdges">
      <path
        d="M20 -9 C14 -9 11.5 -5 11.5 -1.5 C11.5 3 20 9.5 20 9.5 C20 9.5 28.5 3 28.5 -1.5 C28.5 -5 26 -9 20 -9 Z"
        fill="#b23a52"
        stroke="#141414"
        strokeWidth="1.4"
      />
      <circle cx="20" cy="-2" r="3.6" fill="#e0a53a" stroke="#141414" strokeWidth="1" />
    </g>
  );
}

function CoinSVG() {
  return (
    <g>
      <circle cx="20" cy="-1" r="8" fill="#e6b23a" stroke="#141414" strokeWidth="1.4" />
      <circle cx="20" cy="-1" r="5.4" fill="none" stroke="#b8862a" strokeWidth="1" />
      <text
        x="20"
        y="-1"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-mono)"
        fontWeight="700"
        fontSize="8"
        fill="#7a5a18"
      >
        $
      </text>
    </g>
  );
}

function RocketSVG() {
  return (
    <g shapeRendering="crispEdges">
      <polygon points="18,4 20,9 22,4" fill="#e6a53a" />
      <polygon points="16.5,1 13.5,4.5 16.5,4.5" fill="#b23a52" stroke="#141414" strokeWidth="0.9" />
      <polygon points="23.5,1 26.5,4.5 23.5,4.5" fill="#b23a52" stroke="#141414" strokeWidth="0.9" />
      <polygon points="20,-10 23,-4 23,3 17,3 17,-4" fill="#c9ccd6" stroke="#141414" strokeWidth="1.2" />
      <polygon points="20,-10 17,-4 23,-4" fill="#b23a52" stroke="#141414" strokeWidth="1.2" />
      <circle cx="20" cy="-2" r="1.7" fill="#7fb0d8" stroke="#141414" strokeWidth="0.8" />
    </g>
  );
}

/* Envelope with an upload arrow punching through the top flap. */
function UploadEnvelopeSVG() {
  return (
    <svg viewBox="0 0 44 46" width={92} className="block overflow-visible" shapeRendering="crispEdges">
      {/* envelope body */}
      <rect x="2" y="16" width="40" height="28" fill="#e7e4f1" stroke="#141414" strokeWidth="1.8" />
      <polygon points="2,16 22,29 2,44" fill="#cfc9e2" />
      <polygon points="42,16 22,29 42,44" fill="#cfc9e2" />
      <polygon points="2,44 22,27 42,44" fill="#ddd9ee" />
      <polyline points="2,16 22,29 42,16" fill="none" stroke="#141414" strokeWidth="1.8" />
      {/* upload arrow, tucked through the top edge */}
      <polygon points="22,1 30,11 24,11 24,20 20,20 20,11 14,11" fill="#c0455a" stroke="#141414" strokeWidth="1.6" />
      <rect x="21" y="12" width="2" height="7" fill="#d98090" />
      <polygon points="22,3 27,9 22,9" fill="#d98090" />
    </svg>
  );
}

/* Clipboard with a checklist, an envelope propped in front. */
function ChecklistEnvelopeSVG() {
  const rows = [0, 1, 2, 3];
  return (
    <svg viewBox="0 0 48 44" width={92} className="block overflow-visible" shapeRendering="crispEdges">
      {/* clipboard */}
      <rect x="1" y="6" width="26" height="36" fill="#8a5a46" stroke="#141414" strokeWidth="1.6" />
      <rect x="4" y="10" width="20" height="29" fill="#f7f5ef" stroke="#141414" strokeWidth="1.2" />
      <rect x="9" y="0" width="10" height="7" fill="#d9a441" stroke="#141414" strokeWidth="1.4" />
      <rect x="11" y="2" width="6" height="3" fill="#f2d574" />
      {rows.map((r) => (
        <g key={r}>
          <rect x="7" y={14 + r * 6} width="4" height="4" fill="#ffffff" stroke="#141414" strokeWidth="1" />
          <polyline
            points={`7.7,${16 + r * 6} 9,${17.3 + r * 6} 10.6,${14.6 + r * 6}`}
            fill="none"
            stroke="#16a34a"
            strokeWidth="1.1"
          />
          <rect x="13" y={15.2 + r * 6} width="9" height="1.4" fill="#9a938a" />
        </g>
      ))}
      {/* envelope propped over the clipboard */}
      <g>
        <rect x="15" y="19" width="31" height="22" fill="#e7e4f1" stroke="#141414" strokeWidth="1.8" />
        <polygon points="15,19 30.5,30.5 15,41" fill="#cfc9e2" />
        <polygon points="46,19 30.5,30.5 46,41" fill="#cfc9e2" />
        <polygon points="15,41 30.5,29 46,41" fill="#ddd9ee" />
        <polyline points="15,19 30.5,30.5 46,19" fill="none" stroke="#141414" strokeWidth="1.8" />
      </g>
    </svg>
  );
}

/* Blend a hex color toward white; amount 0 = full color, 1 = white. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/* Closed envelope; overlay a padlock / unread badge / heart / pin / coin / rocket. */
function PixelEnvelope({
  color,
  overlay,
  width = 108,
}: {
  color: string;
  overlay?: "lock" | "badge" | "heart" | "pin" | "coin" | "rocket";
  width?: number;
}) {
  const base = tint(color, 0.86);
  const side = tint(color, 0.78);
  const bottom = tint(color, 0.82);
  return (
    <svg viewBox="0 0 40 34" width={width} className="block overflow-visible" shapeRendering="crispEdges">
      {/* fills */}
      <rect x="2" y="6" width="36" height="26" fill={base} />
      <polygon points="2,6 20,20 2,32" fill={side} />
      <polygon points="38,6 20,20 38,32" fill={side} />
      <polygon points="2,32 20,18 38,32" fill={bottom} />
      {/* strokes */}
      <rect x="2" y="6" width="36" height="26" fill="none" stroke="#141414" strokeWidth="1.6" />
      <polyline points="2,6 20,20 38,6" fill="none" stroke="#141414" strokeWidth="1.6" />
      <line x1="2" y1="32" x2="15" y2="21" stroke="#141414" strokeWidth="1" />
      <line x1="38" y1="32" x2="25" y2="21" stroke="#141414" strokeWidth="1" />
      {/* wax colour dot (hidden under a heart) */}
      {overlay !== "heart" && (
        <rect x="18" y="18" width="4" height="4" fill={color} stroke="#141414" strokeWidth="1" />
      )}
      {overlay === "lock" && <PadlockSVG />}
      {overlay === "badge" && <BadgeSVG />}
      {overlay === "heart" && <HeartSVG />}
      {overlay === "pin" && <PinSVG />}
      {overlay === "coin" && <CoinSVG />}
      {overlay === "rocket" && <RocketSVG />}
    </svg>
  );
}

/* Opened envelope with the letter pulled up. */
function PixelEnvelopeOpen({ color }: { color: string }) {
  const back = tint(color, 0.8);
  const pocket = tint(color, 0.86);
  return (
    <svg viewBox="0 0 40 36" width="108" className="block overflow-visible" shapeRendering="crispEdges">
      {/* back flap, raised */}
      <polygon points="5,16 20,4 35,16" fill={back} stroke="#141414" strokeWidth="1.4" />
      {/* letter */}
      <rect x="8" y="9" width="24" height="19" fill="#f7f5ef" stroke="#141414" strokeWidth="1.4" />
      <rect x="8.8" y="9.8" width="22.4" height="4" fill={color} />
      <rect x="11" y="17" width="18" height="1.4" fill="#141414" opacity="0.32" />
      <rect x="11" y="21" width="12" height="1.4" fill="#141414" opacity="0.32" />
      {/* front pocket */}
      <polygon
        points="2,15 20,31 38,15 38,34 2,34"
        fill={pocket}
        stroke="#141414"
        strokeWidth="1.6"
      />
      <line x1="2" y1="34" x2="14" y2="24.5" stroke="#141414" strokeWidth="1" />
      <line x1="38" y1="34" x2="26" y2="24.5" stroke="#141414" strokeWidth="1" />
    </svg>
  );
}

/* ================= seen-state (which letters you've opened) ================= */

function useSeen() {
  const KEY = "tm-seen";
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) setSeen(new Set(a));
      }
    } catch {
      // ignore
    }
  }, []);
  const mark = (id: string) =>
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...n]));
      } catch {
        // ignore
      }
      return n;
    });
  return { seen, mark };
}

/* ================= one grabbable envelope ================= */

function EnvelopeItem({
  letter,
  from,
  seen,
  onOpen,
  onUnlock,
}: {
  letter: LetterRow;
  from: string;
  seen: boolean;
  onOpen: () => void;
  onUnlock: () => void;
}) {
  const unlocked = new Date(letter.unlock_at).getTime() <= Date.now();
  const [opening, setOpening] = useState(false);
  const state: "sealed" | "unread" | "open" = !unlocked ? "sealed" : seen ? "open" : "unread";

  const grab = () => {
    if (!unlocked || opening) return;
    setOpening(true);
    window.setTimeout(() => {
      setOpening(false);
      onOpen();
    }, 260);
  };

  return (
    <div className="env-bob flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={grab}
        disabled={!unlocked}
        aria-label={unlocked ? `Grab to open letter from ${from}` : `Sealed letter from ${from}`}
        className={`bg-transparent p-1 focus:outline-none ${unlocked ? "env-grab" : "env-locked"} ${opening ? "env-opening" : ""}`}
      >
        <div className="env-art relative flex items-center justify-center h-[92px]">
          {state === "open" ? (
            <PixelEnvelopeOpen color={letter.color} />
          ) : (
            <PixelEnvelope color={letter.color} overlay={state === "sealed" ? "lock" : "badge"} />
          )}
        </div>
      </button>
      <div className="brut-mono text-[10px] text-center leading-tight">
        <div>{letter.letter_date.replace(/-/g, ".")}</div>
        <div className="opacity-60 truncate max-w-[110px]">{from}</div>
      </div>
      {state === "sealed" ? (
        <div className="brut-mono text-[9px] opacity-70">
          <CountdownInline unlockAt={letter.unlock_at} onUnlock={onUnlock} />
        </div>
      ) : state === "unread" ? (
        <div className="brut-mono text-[9px] text-[#ff3b1e] font-bold">NEW ✦</div>
      ) : (
        <div className="brut-mono text-[9px] opacity-40">OPENED</div>
      )}
    </div>
  );
}

/* ================= today's prompt ================= */

/* ================= starburst prompt ================= */

function StarburstSVG() {
  const points = 12;
  const outerR = 120;
  const innerR = 72;
  const cx = 130, cy = 130;
  const pts: string[] = [];
  for (let i = 0; i < points; i++) {
    const aOuter = (Math.PI * 2 * i) / points - Math.PI / 2;
    const aInner = (Math.PI * 2 * (i + 0.5)) / points - Math.PI / 2;
    pts.push(`${cx + outerR * Math.cos(aOuter)},${cy + outerR * Math.sin(aOuter)}`);
    pts.push(`${cx + innerR * Math.cos(aInner)},${cy + innerR * Math.sin(aInner)}`);
  }
  return (
    <svg viewBox="0 0 260 260" width="240" height="240" className="block">
      <polygon points={pts.join(" ")} fill="#0d0d0d" transform="translate(7, 9)" />
      <polygon points={pts.join(" ")} fill="#ff3b1e" />
      <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="central"
        className="starburst-text-line1" fill="#fff"
        stroke="#0d0d0d" strokeWidth="5" paintOrder="stroke" strokeLinejoin="round"
        fontFamily="'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive"
        fontWeight="900" fontStyle="italic" fontSize="28">
        Today's
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" dominantBaseline="central"
        className="starburst-text-line2" fill="#fff"
        stroke="#0d0d0d" strokeWidth="5" paintOrder="stroke" strokeLinejoin="round"
        fontFamily="'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive"
        fontWeight="900" fontStyle="italic" fontSize="30">
        Prompt!
      </text>
    </svg>
  );
}

function DiceIcon({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 50 50" width={size} height={size} shapeRendering="crispEdges">
      <rect x="3" y="3" width="44" height="44" rx="6" fill="#ff3b1e" stroke="#0d0d0d" strokeWidth="3" />
      <circle cx="14" cy="14" r="4" fill="#fff" />
      <circle cx="36" cy="14" r="4" fill="#fff" />
      <circle cx="25" cy="25" r="4" fill="#fff" />
      <circle cx="14" cy="36" r="4" fill="#fff" />
      <circle cx="36" cy="36" r="4" fill="#fff" />
    </svg>
  );
}

function TodaysPromptStarburst({ onClick }: { onClick: () => void }) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Today's prompt — click to reveal"
      className="starburst-wrap border-none p-0 focus:outline-none relative flex items-center justify-center"
      style={{ position: "relative", zIndex: 20, background: "transparent", width: 240, height: 240 }}
    >
      <div className="starburst-sway">
        <StarburstSVG />
      </div>
    </button>
  );
}

function PromptRevealCard({ onClose }: { onClose: () => void }) {
  const prompt = useMemo(() => promptForDate(todayUTC()), []);
  const [current, setCurrent] = useState(prompt);
  const [rolling, setRolling] = useState(false);

  const roll = () => {
    if (rolling) return;
    setRolling(true);
    playPop();
    setTimeout(() => {
      let pick = current;
      while (pick === current) {
        pick = DAILY_PROMPTS[Math.floor(Math.random() * DAILY_PROMPTS.length)];
      }
      setCurrent(pick);
      setRolling(false);
    }, 400);
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col">
        <div className="px-6 pt-8 pb-5 text-center border-b-2 border-[#0d0d0d]">
          <p className="font-sans text-xl md:text-2xl leading-snug font-black max-w-md mx-auto">
            {current}
          </p>
        </div>
        <div className="px-6 py-5 flex flex-col items-center gap-3 bg-[#fafafa]">
          <button
            type="button"
            onClick={roll}
            disabled={rolling}
            className={`bg-transparent border-none p-0 focus:outline-none ${rolling ? "dice-rolling" : "dice-bounce"}`}
            aria-label="Roll dice"
          >
            <DiceIcon size={56} />
          </button>
          <span className="brut-mono text-[9px] opacity-40">TAP TO REROLL</span>
        </div>
      </div>
    </Modal>
  );
}

/* ================= root ================= */

function HomePage() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);
  const [reading, setReading] = useState<LetterRow | null>(null);
  const [entered, setEntered] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const { seen, mark } = useSeen();

  const enter = () => setEntered(true);

  const openLetter = (l: LetterRow) => {
    mark(l.id);
    setReading(l);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        if (mounted) setUserId(data.session.user.id);
        return;
      }
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (!error && mounted) setUserId(anon.user?.id ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const { data: myProfile } = useQuery({
    queryKey: ["my-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username,display_name")
        .eq("id", userId as string)
        .maybeSingle();
      return data as { username: string | null; display_name: string | null } | null;
    },
  });

  const { data: myLetters = [] } = useQuery({
    queryKey: ["my-letters", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("letters")
        .select("id,user_id,letter_date,goal,thought,advice,unlock_at,color")
        .eq("user_id", userId as string)
        .order("letter_date", { ascending: true });
      return (data ?? []) as LetterRow[];
    },
  });

  const { data: publicLetters = [] } = useQuery({
    queryKey: ["public-letters"],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("letters")
        .select("id,user_id,letter_date,goal,thought,advice,unlock_at,color,profiles(username)")
        .lte("unlock_at", new Date().toISOString())
        .order("letter_date", { ascending: false })
        .limit(60);
      return (data ?? []) as LetterRow[];
    },
  });

  const today = todayUTC();
  const todayLetter = myLetters.find((l) => l.letter_date === today);
  const pastLetters = myLetters.filter((l) => l.letter_date !== today);
  const myUsername = myProfile?.username ?? null;

  const handleUnlock = () => {
    qc.invalidateQueries({ queryKey: ["my-letters", userId] });
    qc.invalidateQueries({ queryKey: ["public-letters"] });
  };

  return (
    <main className="brut-page min-h-screen w-full overflow-x-hidden text-[#0d0d0d]">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white border-b-2 border-[#0d0d0d]">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="brut-mono font-bold text-sm md:text-base">
            TOMORROW,MAYBE<sup className="text-[9px]">®</sup>
          </span>
          <span className="brut-mono text-[10px] md:text-xs flex items-center gap-2">
            <span>[{myUsername ? `@${myUsername}` : "ANON"}]</span>
            <Clock />
          </span>
        </div>
      </header>

      {/* HERO */}
      <section className="border-b-2 border-[#0d0d0d] px-4 py-10 md:py-16">
        <div className="max-w-5xl mx-auto">
          {todayLetter ? (
            <SealedHero letter={todayLetter} onUnlock={handleUnlock} />
          ) : (
            <div className="grid md:grid-cols-[1fr_auto] gap-10 items-center">
              <div>
                <h1 className="comic-hero uppercase text-5xl sm:text-7xl md:text-8xl">
                  <span className="comic-hero-line">A letter</span>
                  <br />
                  <span className="comic-hero-line">to tomorrow</span>
                  <br />
                  <span className="comic-hero-line comic-hero-accent">—you.</span>
                </h1>
              </div>
              <div className="flex flex-col items-center" style={{ isolation: "isolate" }}>
                {/* starburst overlaps onto envelope below */}
                <div className="mb-[-60px] relative" style={{ zIndex: 20 }}>
                  <TodaysPromptStarburst onClick={() => setDiceOpen(true)} />
                </div>
                <div className="relative" style={{ zIndex: 0 }}>
                  <button
                    type="button"
                    onClick={() => userId && setWriteOpen(true)}
                    aria-label="Grab an envelope to write"
                    className="env-grab bg-transparent p-2 flex flex-col items-center gap-3 focus:outline-none group"
                  >
                    <div className="env-art">
                      <PixelEnvelope color="#db2777" width={176} />
                    </div>
                    <span className="brut-mono text-[11px] font-bold border-2 border-[#0d0d0d] px-3 py-1.5 group-hover:bg-[#0d0d0d] group-hover:text-white transition-colors">
                      ✎ GRAB TO WRITE
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* PLAYGROUND */}
      <section className="border-b-2 border-[#0d0d0d]">
        <SectionHead idx="01" title="Private" count={pastLetters.length} yellow />
        {pastLetters.length === 0 ? null : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-9 px-4 py-9">
            {[...pastLetters].reverse().map((l) => (
              <EnvelopeItem
                key={l.id}
                letter={l}
                from="@you"
                seen={seen.has(l.id)}
                onOpen={() => openLetter(l)}
                onUnlock={handleUnlock}
              />
            ))}
          </div>
        )}
      </section>

      {/* PUBLIC */}
      <section className="border-b-2 border-[#0d0d0d]">
        <SectionHead idx="02" title="Public" count={publicLetters.length} acid />
        {publicLetters.length === 0 ? null : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-9 px-4 py-9">
            {publicLetters.map((l) => (
              <EnvelopeItem
                key={l.id}
                letter={l}
                from={l.user_id === userId ? "@you" : `@${nameOf(l)}`}
                seen={seen.has(l.id)}
                onOpen={() => openLetter(l)}
                onUnlock={handleUnlock}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="px-4 py-10 flex flex-col sm:flex-row items-center justify-between gap-2 brut-mono text-[10px]">
        <span>TOMORROW MAYBE</span>
        <span>{new Date().getFullYear()}</span>
      </footer>

      {!entered && <LandingGate onEnter={enter} />}

      {diceOpen && <PromptRevealCard onClose={() => setDiceOpen(false)} />}

      {reading && (
        <ReaderModal letter={reading} currentUserId={userId} onClose={() => setReading(null)} />
      )}

      {writeOpen && userId && (
        <WriteModal
          userId={userId}
          initialUsername={myUsername}
          onClose={() => setWriteOpen(false)}
          onSealed={() => {
            setWriteOpen(false);
            qc.invalidateQueries({ queryKey: ["my-letters", userId] });
            qc.invalidateQueries({ queryKey: ["my-profile", userId] });
          }}
        />
      )}
    </main>
  );
}

/* ================= header clock ================= */

function Clock() {
  const [t, setT] = useState<string>("--:--:--");
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString("en-GB", { hour12: false });
    setT(fmt());
    const id = setInterval(() => setT(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{t}</span>;
}

/* ================= landing gate ================= */

type SatType = "heart" | "lock" | "badge" | "pin" | "coin" | "rocket" | "upload" | "checklist";

const SATELLITES: { a: number; type: SatType; color?: string }[] = [
  { a: 0, type: "heart", color: "#db2777" },
  { a: 45, type: "upload" },
  { a: 90, type: "lock", color: "#2563eb" },
  { a: 135, type: "checklist" },
  { a: 180, type: "badge", color: "#e11d48" },
  { a: 225, type: "coin", color: "#ca8a04" },
  { a: 270, type: "pin", color: "#7c3aed" },
  { a: 315, type: "rocket", color: "#ea580c" },
];

const ORBIT_R = 380;

/* One orbiting icon; grabbable with the mouse, springs back to its orbit slot on release. */
function OrbitSatellite({ angle, children }: { angle: number; children: React.ReactNode }) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, originX: 0, originY: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture is best-effort; dragging still works without it
    }
    startRef.current = { mouseX: e.clientX, mouseY: e.clientY, originX: drag.x, originY: drag.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const { mouseX, mouseY, originX, originY } = startRef.current;
    setDrag({ x: originX + (e.clientX - mouseX), y: originY + (e.clientY - mouseY) });
  };
  const releaseDrag = () => {
    setDragging(false);
    setDrag({ x: 0, y: 0 });
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releaseDrag}
      onPointerCancel={releaseDrag}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transformOrigin: "0 0",
        touchAction: "none",
        cursor: dragging ? "grabbing" : "grab",
        transition: dragging ? "none" : "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: `translate(${drag.x}px, ${drag.y}px) rotate(${angle}deg) translateX(min(${ORBIT_R}px, 40vw, 38vh))`,
      }}
    >
      {children}
    </div>
  );
}

function LandingGate({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="gate-fade pixel-grid-bg fixed inset-0 z-40 overflow-hidden flex items-center justify-center">
      {/* orbiting envelopes */}
      <div className="orbit absolute" style={{ width: 860, height: 860 }}>
        {SATELLITES.map((s, i) => (
          <OrbitSatellite key={i} angle={s.a}>
            <div style={{ transform: "translate(-50%, -50%)" }}>
              <div className="orbit-upright">
                <div style={{ transform: `rotate(${-s.a}deg)` }}>
                  <div className="sat-scale">
                    <div className="env-bob">
                      {s.type === "upload" ? (
                        <UploadEnvelopeSVG />
                      ) : s.type === "checklist" ? (
                        <ChecklistEnvelopeSVG />
                      ) : (
                        <PixelEnvelope color={s.color ?? "#7c6fd6"} overlay={s.type} width={92} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </OrbitSatellite>
        ))}
      </div>

      {/* center */}
      <div className="relative z-10 flex flex-col items-center gap-3 sm:gap-5 text-center px-4">
        <div className="brut-mono text-xs md:text-sm font-bold bg-white px-3 py-1">
          TOMORROW,MAYBE<sup className="text-[9px]">®</sup>
        </div>
        <button
          type="button"
          onClick={onEnter}
          className="pixel-enter-btn font-sans font-black uppercase tracking-tight text-xl sm:text-2xl md:text-3xl px-6 sm:px-7 md:px-8 py-2.5 sm:py-3 md:py-3.5"
        >
          Enter
        </button>
      </div>
    </div>
  );
}

/* ================= section chrome ================= */

function SectionHead({
  idx,
  title,
  count,
  acid,
  yellow,
}: {
  idx: string;
  title: string;
  count: number;
  acid?: boolean;
  yellow?: boolean;
}) {
  const bg = acid ? "bg-[#ff3b1e] text-white" : yellow ? "bg-[#f5c518] text-[#0d0d0d]" : "";
  return (
    <div
      className={`flex items-baseline justify-between gap-3 px-4 py-3 border-b-2 border-[#0d0d0d] ${bg}`}
    >
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="brut-mono text-xs opacity-60">{idx}</span>
        <h2 className="font-sans font-black uppercase tracking-tight text-2xl md:text-4xl truncate">
          {title}
        </h2>
      </div>
      <span className="brut-mono text-xs font-bold flex-shrink-0">[{pad2(count)}]</span>
    </div>
  );
}

/* ================= hero: today's sealed letter ================= */

function SealedHero({ letter, onUnlock }: { letter: LetterRow; onUnlock: () => void }) {
  return (
    <div className="flex flex-col md:flex-row gap-8 md:gap-12 items-center justify-center text-center md:text-left">
      <div className="env-bob flex flex-col items-center gap-2">
        <div className="env-art">
          <PixelEnvelope color={letter.color} overlay="lock" width={168} />
        </div>
        <span className="brut-mono text-[10px] opacity-60">LOCKED</span>
      </div>
      <div>
        <div className="brut-mono text-[11px] mb-3 inline-flex items-center gap-2 border-2 border-[#0d0d0d] px-2 py-1">
          <span className="swatch" style={{ backgroundColor: letter.color }} />
          STATUS: SEALED — TODAY
        </div>
        <h1 className="font-sans font-black uppercase leading-[1.5] tracking-tight text-4xl sm:text-6xl md:text-7xl">
          Written.
          <br />
          Now we wait.
        </h1>
        <div className="mt-5">
          <Countdown unlockAt={letter.unlock_at} onUnlock={onUnlock} />
        </div>
      </div>
    </div>
  );
}

/* ================= countdown ================= */

function useCountdown(unlockAt: string, onUnlock: () => void) {
  const [diffMs, setDiffMs] = useState(() => new Date(unlockAt).getTime() - Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const tick = () => {
      const d = new Date(unlockAt).getTime() - Date.now();
      setDiffMs(d);
      if (d <= 0 && !firedRef.current) {
        firedRef.current = true;
        onUnlock();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [unlockAt, onUnlock]);

  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  return {
    done: diffMs <= 0,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function Countdown({ unlockAt, onUnlock }: { unlockAt: string; onUnlock: () => void }) {
  const { done, days, hours, minutes, seconds } = useCountdown(unlockAt, onUnlock);

  if (done) {
    return (
      <div className="brut-mono text-xl border-2 border-[#0d0d0d] px-5 py-6 bg-[#ff3b1e] text-white">
        OPENING <span className="brut-blink">▮</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="brut-mono text-[10px]">UNLOCKS IN ↓</div>
      <div className="flex items-stretch gap-1.5">
        {days > 0 && (
          <>
            <Digit value={days} label="DAY" />
            <Colon />
          </>
        )}
        <Digit value={hours} label="HRS" />
        <Colon />
        <Digit value={minutes} label="MIN" />
        <Colon />
        <Digit value={seconds} label="SEC" />
      </div>
    </div>
  );
}

function Digit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="brut-digit text-4xl md:text-6xl px-2.5 py-2 min-w-[60px] md:min-w-[84px] text-center">
        {pad2(value)}
      </div>
      <div className="brut-mono text-[9px]">{label}</div>
    </div>
  );
}

function Colon() {
  return <span className="brut-blink self-start font-mono text-4xl md:text-6xl leading-none pt-1">:</span>;
}

function CountdownInline({ unlockAt, onUnlock }: { unlockAt: string; onUnlock: () => void }) {
  const { done, days, hours, minutes, seconds } = useCountdown(unlockAt, onUnlock);
  if (done) return <span className="brut-blink">▮</span>;
  return (
    <span className="tabular-nums">
      {days > 0 ? `${days}D ` : ""}
      {pad2(hours)}:{pad2(minutes)}:{pad2(seconds)}
    </span>
  );
}

/* ================= reader modal ================= */

function ReaderModal({
  letter,
  currentUserId,
  onClose,
}: {
  letter: LetterRow;
  currentUserId: string | null;
  onClose: () => void;
}) {
  const isMine = letter.user_id === currentUserId;
  const messages = messagesOf(letter);
  return (
    <Modal onClose={onClose}>
      <div className="border-b-2 border-[#0d0d0d] px-5 py-3 flex items-center justify-between gap-3">
        <span className="brut-mono text-[11px] font-bold flex items-center gap-2 min-w-0 truncate">
          <span className="swatch" style={{ backgroundColor: letter.color }} />
          LETTER · {letter.letter_date.replace(/-/g, ".")} ·{" "}
          {isMine ? "FROM YESTERDAY-YOU" : `FROM @${nameOf(letter)}`}
        </span>
      </div>
      <div className="px-5 py-6">
        {isMine ? (
          <OpenedThread letterId={letter.id} messages={messages} />
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <BrutMsg key={i} message={m} side="left" />
              ))}
            </div>
            <ReactionBar letterId={letter.id} currentUserId={currentUserId} />
          </>
        )}
      </div>
    </Modal>
  );
}

/* ================= progressive reply thread ================= */

function OpenedThread({ letterId, messages }: { letterId: string; messages: string[] }) {
  const storageKey = `tm-replies:${letterId}`;
  const [replies, setReplies] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setReplies(arr.filter((m) => typeof m === "string"));
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(replies));
      } catch {
        // ignore
      }
    }
  }, [replies, loaded, storageKey]);

  const revealed = Math.min(messages.length, replies.length + 1);
  const canReply = true;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [revealed, replies.length]);

  const sendReply = () => {
    const t = draft.trim();
    if (!t || !canReply) return;
    setReplies((r) => [...r, t]);
    setDraft("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  const rows: React.ReactNode[] = [];
  const rowCount = Math.max(revealed, replies.length);
  for (let i = 0; i < rowCount; i++) {
    if (i < revealed) {
      rows.push(<BrutMsg key={`m-${i}`} message={messages[i]} side="left" />);
    }
    if (i < replies.length) {
      rows.push(<BrutMsg key={`r-${i}`} message={replies[i]} side="right" />);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows}
      <div ref={endRef} />
      {canReply && (
        <div className="flex items-stretch gap-0 mt-2 border-2 border-[#0d0d0d]">
          <span className="brut-mono text-sm px-3 flex items-center border-r-2 border-[#0d0d0d]">&gt;</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="TYPE A REPLY — ENTER TO SEND"
            rows={1}
            className="flex-1 bg-transparent px-3 py-3 focus:outline-none font-sans text-base resize-none placeholder:brut-mono placeholder:text-[10px] placeholder:opacity-50 max-h-28"
          />
          <button
            type="button"
            onClick={sendReply}
            className="brut-btn px-4 text-sm font-bold border-0 border-l-2"
            aria-label="Send reply"
          >
            ▸
          </button>
        </div>
      )}
    </div>
  );
}

function BrutMsg({ message, side }: { message: string; side: "left" | "right" }) {
  return (
    <div className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div className="brut-msg px-4 py-3 max-w-[86%]" data-side={side}>
        <span className="brut-mono text-[9px] opacity-60 block mb-1">
          {side === "right" ? "YOU →" : "← PAST"}
        </span>
        <p className="font-sans text-[15px] leading-relaxed whitespace-pre-wrap">{message}</p>
      </div>
    </div>
  );
}

/* ================= reactions ================= */

function ReactionBar({
  letterId,
  currentUserId,
}: {
  letterId: string;
  currentUserId: string | null;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [popped, setPopped] = useState<string | null>(null);

  const { data: reactions = [] } = useQuery({
    queryKey: ["reactions", letterId],
    queryFn: async () => {
      const { data } = await supabase
        .from("reactions")
        .select("letter_id,emoji,user_id")
        .eq("letter_id", letterId);
      return (data ?? []) as ReactionRow[];
    },
  });

  const counts = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of reactions) {
      const cur = map.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (r.user_id === currentUserId) cur.mine = true;
      map.set(r.emoji, cur);
    }
    return map;
  }, [reactions, currentUserId]);

  const toggle = async (emoji: string) => {
    if (!currentUserId || busy) return;
    playPop();
    setPopped(emoji);
    setTimeout(() => setPopped((p) => (p === emoji ? null : p)), 420);
    setBusy(true);
    const mine = counts.get(emoji)?.mine;
    if (mine) {
      await supabase
        .from("reactions")
        .delete()
        .eq("letter_id", letterId)
        .eq("user_id", currentUserId)
        .eq("emoji", emoji);
    } else {
      const { error } = await supabase
        .from("reactions")
        .insert({ letter_id: letterId, user_id: currentUserId, emoji });
      if (error && !error.message.includes("duplicate")) toast.error(error.message);
    }
    await qc.invalidateQueries({ queryKey: ["reactions", letterId] });
    setBusy(false);
  };

  return (
    <div className="mt-5 pt-4 border-t-2 border-[#0d0d0d]">
      <div className="brut-mono text-[9px] mb-2 opacity-60">REACT ↓</div>
      <div className="flex flex-wrap gap-2">
        {REACTION_EMOJI.map((emoji) => {
          const c = counts.get(emoji);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => toggle(emoji)}
              disabled={busy}
              data-mine={c?.mine ? "true" : "false"}
              className="brut-react px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
              aria-label={`React ${emoji}`}
            >
              <span className={`react-emoji leading-none text-2xl ${popped === emoji ? "react-pop" : ""}`}>
                {emoji}
              </span>
              <span className="brut-mono text-[10px]">{c?.count ? pad2(c.count) : "00"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ================= write modal ================= */

const LETTER_COLORS = [
  "#2563eb", // deep blue
  "#7c3aed", // violet
  "#db2777", // deep pink
  "#e11d48", // rose
  "#ea580c", // orange
  "#16a34a", // green
  "#0d9488", // teal
  "#ca8a04", // gold
  "#4f46e5", // indigo
  "#9333ea", // purple
];

function sanitizeUsername(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

function WriteModal({
  userId,
  initialUsername,
  onClose,
  onSealed,
}: {
  userId: string;
  initialUsername: string | null;
  onClose: () => void;
  onSealed: () => void;
}) {
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState(LETTER_COLORS[0]);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, text]);
    setDraft("");
  };

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalMessages = draft.trim() ? [...messages, draft.trim()] : messages;
    if (finalMessages.length === 0) {
      toast.error("Send at least one message before sealing.");
      return;
    }
    setSubmitting(true);

    const cleanName = sanitizeUsername(username);
    if (cleanName && cleanName !== initialUsername) {
      const { error: profErr } = await supabase
        .from("profiles")
        .update({ username: cleanName, display_name: username.trim() || cleanName })
        .eq("id", userId);
      if (profErr && profErr.message.toLowerCase().includes("duplicate")) {
        setSubmitting(false);
        toast.error("That name is taken — try another.");
        return;
      }
    }

    const { error } = await supabase.from("letters").insert({
      user_id: userId,
      letter_date: todayUTC(),
      thought: JSON.stringify(finalMessages),
      color,
      recipient_email: email.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("SEALED. COME BACK TOMORROW.");
    onSealed();
  };

  return (
    <Modal onClose={onClose}>
      <div className="border-b-2 border-[#0d0d0d] px-5 py-3 flex items-center justify-between">
        <span className="brut-mono text-[11px] font-bold">
          NEW LETTER //{" "}
          {new Date()
            .toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </span>
      </div>

      <form onSubmit={submit} className="px-5 py-5">
        {/* username */}
        <div className="flex items-stretch border-2 border-[#0d0d0d] mb-4">
          <span className="brut-mono text-[11px] px-3 flex items-center border-r-2 border-[#0d0d0d]">
            SIGNED @
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="YOUR-NAME"
            maxLength={24}
            className="flex-1 bg-transparent px-3 py-2.5 focus:outline-none font-sans text-base placeholder:brut-mono placeholder:text-[10px] placeholder:opacity-40"
          />
        </div>

        {/* colour picker */}
        <div className="flex items-center gap-2 mb-4">
          <span className="brut-mono text-[10px] opacity-60">SEAL:</span>
          {LETTER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              className="w-5 h-5 border-2 border-[#0d0d0d]"
              style={{
                backgroundColor: c,
                boxShadow: color === c ? "3px 3px 0 #0d0d0d" : "none",
              }}
            />
          ))}
        </div>

        {/* message list */}
        <div
          ref={listRef}
          className="flex flex-col gap-2.5 max-h-64 overflow-y-auto border-2 border-[#0d0d0d] p-3 mb-3 bg-[#f4f2ea]"
        >
          {messages.length === 0 ? (
            <p className="brut-mono text-[10px] opacity-40 text-center py-8">
              DEAR TOMORROW — SAY THE FIRST THING ON YOUR MIND.
            </p>
          ) : (
            messages.map((m, i) => <BrutMsg key={i} message={m} side="right" />)
          )}
        </div>

        {/* draft input */}
        <div className="flex items-stretch border-2 border-[#0d0d0d] mb-4">
          <span className="brut-mono text-sm px-3 flex items-center border-r-2 border-[#0d0d0d]">&gt;</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleDraftKeyDown}
            placeholder="TYPE A MESSAGE — ENTER TO SEND"
            rows={1}
            autoFocus
            className="flex-1 bg-transparent px-3 py-3 focus:outline-none font-sans text-base resize-none placeholder:brut-mono placeholder:text-[10px] placeholder:opacity-40 max-h-28"
          />
          <button
            type="button"
            onClick={send}
            className="brut-btn px-4 text-sm font-bold border-0 border-l-2"
            aria-label="Send message"
          >
            ▸
          </button>
        </div>

        {/* email */}
        <div className="flex items-stretch border-2 border-[#0d0d0d] mb-5">
          <span className="brut-mono text-[10px] px-3 flex items-center border-r-2 border-[#0d0d0d]">
            NOTIFY
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="YOU@EXAMPLE.COM (OPTIONAL)"
            className="flex-1 bg-transparent px-3 py-2.5 focus:outline-none font-sans text-sm placeholder:brut-mono placeholder:text-[10px] placeholder:opacity-40"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="brut-btn px-5 py-3 text-xs font-bold"
          >
            [ CANCEL ]
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="brut-btn brut-btn-acid px-6 py-3 text-xs font-bold disabled:opacity-40"
          >
            {submitting ? "SEALING…" : "[ SEAL ▸ ]"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ================= modal shell ================= */

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center px-3 py-6 sm:py-10 bg-[#0d0d0d]/80"
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      ref={ref}
    >
      <div className="modal-pop relative w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white border-2 border-[#0d0d0d] shadow-[8px_8px_0_#0d0d0d]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 z-10 w-8 h-8 brut-btn font-bold flex items-center justify-center"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
