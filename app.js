// Opus Juris Support portal: one page, the inbox on the left, the
// conversation on the right, a reply box. Reads and writes the support
// tables on the vendor project as the signed-in support owner (the row
// policies of migration 196 decide who that is). Polls every 30 seconds.
(function () {
  "use strict";
  const cfg = window.PORTAL_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const $ = (id) => document.getElementById(id);
  let me = null, threads = [], current = null, filter = "needs", timer = null, fast = null, sending = false, seen = "";

  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dayOf = (iso) => { const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1); if (d.toDateString() === now.toDateString()) return "Today"; if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const when = (iso) => (dayOf(iso) === "Today" ? timeOf(iso) : dayOf(iso));
  const tag = (s) => '<span class="tag ' + esc(s) + '">' + esc({ open: "Open", waiting: "Needs a reply", answered: "Answered", closed: "Closed" }[s] || s) + "</span>";
  const nameOf = (from) => ({ user: "", assistant: "Opus Juris Help", owner: "You" })[from] || from;

  // ── sign in ──
  async function boot() {
    const { data } = await sb.auth.getSession();
    if (data && data.session) return enter(data.session.user);
    $("signin").classList.remove("hidden");
  }
  $("signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("signin-err").textContent = "";
    const { data, error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    if (error || !data.session) { const m = String((error && error.message) || ""); $("signin-err").textContent = /invalid login credentials/i.test(m) ? "That email or password is incorrect." : (m ? "Sign-in failed: " + m : "Sign-in failed. Check your connection and try again."); return; }
    enter(data.session.user);
  });
  $("signout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
  async function enter(user) {
    me = user;
    // Not a support owner: the policies return nothing, so say so plainly.
    const { data: owner } = await sb.from("support_owners").select("email").limit(1);
    if (!owner || !owner.length) { $("signin").classList.remove("hidden"); $("signin-err").textContent = "This account is not a support owner."; await sb.auth.signOut(); return; }
    $("signin").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("me").textContent = user.email || "";
    await load();
    timer = setInterval(load, 15000);
    // The open thread is re-read every few seconds, so the person's next
    // message lands as they send it; the view is rebuilt only on a change.
    fast = setInterval(async () => {
      if (!current || document.hidden || sending) return;
      const id = current.id;
      const { data, error } = await sb.from("support_messages").select("id, at").eq("thread_id", id).order("at", { ascending: true });
      if (error || !current || current.id !== id) return;
      const key = (data || []).map((m) => m.id).join(",");
      if (key !== seen) { seen = key; await openThread(id, true); }
    }, 4000);
  }

  // ── inbox ──
  async function load() {
    const { data, error } = await sb.from("support_threads").select("*").order("updated_at", { ascending: false }).limit(200);
    if (error) { $("inbox-status").textContent = "Could not load: " + error.message; return; }
    threads = data || [];
    renderInbox();
    if (current) { const t = threads.find((x) => x.id === current.id); if (t) { current = t; await openThread(t.id, true); } }
    $("inbox-status").textContent = threads.length ? "" : "No conversations yet.";
  }
  function shown() {
    if (filter === "needs") return threads.filter((t) => t.status === "waiting" || t.unread_for_owner > 0);
    if (filter === "open") return threads.filter((t) => t.status !== "closed");
    return threads;
  }
  function renderInbox() {
    const list = shown();
    $("rows").innerHTML = list.map((t) => '<button class="row' + (current && current.id === t.id ? " on" : "") + '" data-id="' + esc(t.id) + '" type="button">' +
      '<div class="top">' + (t.unread_for_owner > 0 ? '<span class="dot"></span>' : "") + '<span class="who">' + esc(t.user_name || t.user_email) + '</span><span class="when">' + esc(when(t.updated_at)) + "</span></div>" +
      '<div class="subject">' + esc(t.subject || "(no subject)") + "</div>" +
      '<div class="meta">' + tag(t.status) + "<span>" + esc(t.domain) + "</span></div></button>").join("") || '<div class="status">Nothing here.</div>';
    for (const b of $("rows").querySelectorAll("button.row")) b.addEventListener("click", () => openThread(b.getAttribute("data-id")));
  }
  for (const b of document.querySelectorAll("#inbox .filters button")) b.addEventListener("click", () => { filter = b.getAttribute("data-f"); for (const x of document.querySelectorAll("#inbox .filters button")) x.classList.toggle("on", x === b); renderInbox(); });

  // ── one conversation ──
  async function openThread(id, quiet) {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    current = t;
    $("app").classList.add("showing-thread");
    $("empty").classList.add("hidden");
    $("thread-body").classList.remove("hidden");
    $("t-who").textContent = (t.user_name || t.user_email) + (t.user_name ? " (" + t.user_email + ")" : "");
    $("t-meta").innerHTML = tag(t.status) + " " + esc(t.domain) + " · " + esc(t.subject || "");
    $("brief").classList.toggle("hidden", !t.brief);
    $("brief").textContent = t.brief ? "Brief: " + t.brief : "";
    $("facts").textContent = ["Version " + (t.app_version || "?"), t.os || "", t.where_at ? "In: " + t.where_at : ""].filter(Boolean).join(" · ");
    $("t-close").classList.toggle("hidden", t.status === "closed");
    $("t-reopen").classList.toggle("hidden", t.status !== "closed");
    const { data: msgs, error } = await sb.from("support_messages").select("*").eq("thread_id", id).order("at", { ascending: true });
    if (error) { $("msgs").innerHTML = '<div class="status">Could not load: ' + esc(error.message) + "</div>"; return; }
    seen = (msgs || []).map((m) => m.id).join(",");
    let html = "", lastDay = "";
    for (const m of msgs || []) {
      const d = dayOf(m.at);
      if (d !== lastDay) { html += '<div class="day">' + esc(d) + "</div>"; lastDay = d; }
      const mine = m.from_role === "owner";
      html += '<div class="m' + (mine ? " mine" : "") + '"><span class="av ' + esc(m.from_role) + '">' + (m.from_role === "assistant" ? "OJ" : m.from_role === "owner" ? "S" : esc((t.user_name || t.user_email || "?").slice(0, 1).toUpperCase())) + "</span><div class=\"b\">" +
        (nameOf(m.from_role) ? '<div class="name">' + esc(nameOf(m.from_role)) + "</div>" : "") +
        '<div class="text' + (m.note ? " note" : "") + '">' + esc(m.text) + "</div><div class=\"time\">" + esc(timeOf(m.at)) + "</div></div></div>";
    }
    if (t.handed_at && t.status === "waiting") html += '<div class="handed">Passed to you</div>';
    $("msgs").innerHTML = html;
    $("msgs").scrollTop = $("msgs").scrollHeight;
    if (t.unread_for_owner > 0) { await sb.from("support_threads").update({ unread_for_owner: 0 }).eq("id", id); t.unread_for_owner = 0; renderInbox(); }
    if (!quiet) { $("reply").focus(); renderInbox(); }
  }
  $("back").addEventListener("click", () => { $("app").classList.remove("showing-thread"); current = null; renderInbox(); });

  // ── reply, close, reopen ──
  $("reply").addEventListener("input", () => { $("send").disabled = !$("reply").value.trim() || sending; const el = $("reply"); el.style.height = "auto"; el.style.height = Math.min(160, el.scrollHeight) + "px"; });
  $("reply").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("send").addEventListener("click", send);
  async function send() {
    const text = $("reply").value.trim();
    if (!text || !current || sending) return;
    sending = true; $("send").disabled = true;
    const { error } = await sb.rpc("support_owner_reply", { p_thread_id: current.id, p_text: text });
    sending = false;
    if (error) { alert("The reply was not sent: " + error.message); $("send").disabled = false; return; }
    $("reply").value = ""; $("reply").style.height = "";
    await load();
  }
  $("t-close").addEventListener("click", async () => {
    if (!current) return;
    const { error } = await sb.from("support_threads").update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", current.id);
    if (error) alert("Could not close: " + error.message); else await load();
  });
  $("t-reopen").addEventListener("click", async () => {
    if (!current) return;
    const { error } = await sb.from("support_threads").update({ status: "answered", updated_at: new Date().toISOString() }).eq("id", current.id);
    if (error) alert("Could not reopen: " + error.message); else await load();
  });
  $("refresh").addEventListener("click", load);

  boot();
})();
