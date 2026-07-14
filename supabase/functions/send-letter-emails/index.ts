// Scheduled push: emails writers the moment their sealed letter opens.
//
// Invoked on a schedule (see the pg_cron migration). For every letter whose
// `unlock_at` has passed, that has a `recipient_email`, and that hasn't been
// delivered yet, it sends a "your letter just opened" email and stamps
// `delivered_at` so it's never sent twice.
//
// Requires two secrets set on the function:
//   RESEND_API_KEY   — https://resend.com api key
//   LETTER_FROM      — verified from-address, e.g. "Tomorrow, Maybe <hi@yourdomain.com>"
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LetterRow = {
  id: string;
  recipient_email: string;
  thought: string | null;
  goal: string | null;
  advice: string | null;
  color: string;
  letter_date: string;
};

function messagesOf(l: LetterRow): string[] {
  const raw = l.thought;
  if (raw && raw.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((m) => typeof m === "string" && m.trim());
    } catch {
      // fall through
    }
  }
  if (raw) return [raw];
  const legacy = [l.goal, l.advice].filter(Boolean).join(" ");
  return legacy ? [legacy] : [];
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderEmail(l: LetterRow): string {
  const lines = messagesOf(l)
    .map(
      (m) =>
        `<p style="margin:0 0 14px;font-family:Georgia,serif;font-size:17px;line-height:1.7;color:#3a2e20;">${escapeHtml(
          m,
        )}</p>`,
    )
    .join("");
  return `
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;background:#f7f1e6;border-radius:14px;">
    <div style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#2a3b6b;margin-bottom:6px;">
      Tomorrow, Maybe
    </div>
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9a8f7d;margin-bottom:22px;">
      a letter you sealed has opened
    </div>
    <div style="border-left:4px solid ${l.color};padding-left:16px;">${lines}</div>
    <div style="margin-top:26px;font-family:monospace;font-size:11px;letter-spacing:1px;color:#b0a693;">
      written ${l.letter_date} · reply to yourself when you visit
    </div>
  </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("LETTER_FROM") ?? "Tomorrow, Maybe <onboarding@resend.dev>";

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("letters")
    .select("id,recipient_email,thought,goal,advice,color,letter_date")
    .lte("unlock_at", new Date().toISOString())
    .is("delivered_at", null)
    .not("recipient_email", "is", null)
    .limit(100);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const letters = (data ?? []) as LetterRow[];
  if (!resendKey) {
    return new Response(
      JSON.stringify({ pending: letters.length, sent: 0, note: "RESEND_API_KEY not set" }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  let sent = 0;
  for (const letter of letters) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [letter.recipient_email],
          subject: "Your letter just opened — hear from yesterday",
          html: renderEmail(letter),
        }),
      });
      if (!res.ok) {
        console.error("resend failed", letter.id, await res.text());
        continue;
      }
      await supabase
        .from("letters")
        .update({ delivered_at: new Date().toISOString() })
        .eq("id", letter.id);
      sent++;
    } catch (e) {
      console.error("send error", letter.id, e);
    }
  }

  return new Response(JSON.stringify({ pending: letters.length, sent }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
