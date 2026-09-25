(() => {
  "use strict";
  const MAX_PHOTOS = 5;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const label = { none: "Not yet", seen: "Seen from shore or boat", toured: "Toured" };
  const longDate = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const shortDate = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const coords = (l) => `${Math.abs(l.lat).toFixed(4)}° N  ${Math.abs(l.lon).toFixed(4)}° W`;

  let S = { lighthouses: [], visits: {}, signedIn: false, needsSetup: false, csrf: "" };
  let sel = (location.hash || "").slice(1) || null;
  let mode = "view"; // view | edit | signin
  let filter = "all";
  let busy = false;
  const markers = {};

  const status = (id) => (S.visits[id] ? S.visits[id].status : "none");
  const byId = (id) => S.lighthouses.find((l) => l.id === id);

  async function api(action, body) {
    const opts = body ? { method: "POST", body, headers: { "X-CSRF": S.csrf } } : {};
    const res = await fetch(`api.php?action=${action}`, { credentials: "same-origin", ...opts });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || (res.status === 413 ? "That photo is too large for the server." : `Something went wrong (${res.status}).`));
    return data;
  }
  const form = (obj) => { const f = new FormData(); for (const k in obj) f.append(k, obj[k]); return f; };

  // ---- map ----
  const map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.5 }).setView([47.6, -123.2], 7);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  map.on("click", () => map.scrollWheelZoom.enable());

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function markerStyle(id) {
    const on = status(id) !== "none";
    return {
      radius: id === sel ? 10 : 8,
      color: id === sel ? cssVar("--ink") : on ? cssVar("--surface") : cssVar("--unvisited"),
      weight: id === sel ? 3.5 : 2.5,
      fillColor: on ? cssVar("--lamp") : cssVar("--surface"),
      fillOpacity: 1,
    };
  }
  function drawMarkers() {
    for (const l of S.lighthouses) {
      if (!markers[l.id]) {
        markers[l.id] = L.circleMarker([l.lat, l.lon], markerStyle(l.id))
          .bindTooltip(l.name, { direction: "top", offset: [0, -8] })
          .on("click", () => pick(l.id, false))
          .addTo(map);
      }
      markers[l.id].setStyle(markerStyle(l.id));
      if (l.id === sel) markers[l.id].bringToFront();
    }
  }

  // ---- rendering ----
  function render() {
    const n = S.lighthouses.filter((l) => status(l.id) !== "none").length;
    $("#count").innerHTML = `${n} <span>/ ${S.lighthouses.length} visited</span>`;
    $("#fill").style.width = `${S.lighthouses.length ? (n / S.lighthouses.length) * 100 : 0}%`;
    drawMarkers();
    renderList();
    renderPanel();
    $("#who").innerHTML = S.signedIn ? `Signed in · <button class="linkish" id="signout">Sign out</button>` : `<button class="linkish" id="signin">Sign in</button>`;
  }

  function renderList() {
    const shown = S.lighthouses.filter((l) => filter === "all" || (filter === "done") === (status(l.id) !== "none"));
    const tabs = [["all", "All"], ["done", "Visited"], ["todo", "Not yet"]]
      .map(([k, t]) => `<button data-f="${k}" aria-pressed="${filter === k}">${t}</button>`).join("");
    $("#list").innerHTML = `<div class="lhead"><h3>All lighthouses</h3><div class="filters" role="group" aria-label="Filter the list">${tabs}</div></div>
      <ul>${shown.map((l) => {
        const s = status(l.id), v = S.visits[l.id];
        const right = s === "none" ? "" : v.date ? shortDate(v.date) : s === "seen" ? "Seen" : "Toured";
        return `<li class="${l.id === sel ? "cur" : ""}"><button data-id="${l.id}"><b class="${s === "none" ? "off" : "on"}"></b><span class="nm">${esc(l.name)}<small>${esc(l.place)}</small></span><span class="dt">${esc(right)}</span></button></li>`;
      }).join("") || `<li class="muted" style="padding:8px 2px">Nothing here yet.</li>`}</ul>`;
  }

  function header(l) {
    return `<p class="eyebrow">${esc(l.region)}</p><h2>${esc(l.name)}</h2><div class="coords">${esc(l.place)} · lit ${l.lit}<br>${coords(l)}</div>`;
  }

  function paragraphs(text) {
    return text.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  function renderPanel() {
    const panel = $("#panel");
    if (mode === "signin") return renderSignin(panel);
    const l = byId(sel);
    if (!l) {
      panel.innerHTML = `<p class="eyebrow">Washington State</p><h2>Pick a lighthouse</h2><p class="muted">Tap a pin on the map or a name in the list to see the visit, photos and notes.</p>`;
      return;
    }
    const v = S.visits[l.id], s = status(l.id);
    if (mode === "edit" && S.signedIn) return renderEdit(panel, l, v);

    let body = `<span class="chip ${s}">${label[s]}</span>`;
    if (!v) {
      body += `<p class="muted">Not visited yet.</p>`;
    } else {
      body += `<dl><dt>Visited</dt><dd>${v.date ? longDate(v.date) : '<span class="muted">Date not set</span>'}</dd></dl>`;
      if (v.photos.length) {
        body += `<p class="eyebrow">Photos</p><div class="photos">${v.photos.map((p, i) =>
          `<a class="ph" href="${esc(p.full)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="Photo ${i + 1} of ${esc(l.name)}" loading="lazy"></a>`).join("")}</div>`;
      }
      if (v.notes && v.notes.trim()) body += `<p class="eyebrow" style="margin-top:18px">Notes</p><div class="notes">${paragraphs(v.notes)}</div>`;
    }
    if (S.signedIn) body += `<div class="row"><button class="btn primary" id="edit">${v ? "Edit visit" : "Log a visit"}</button></div>`;
    panel.innerHTML = header(l) + body;
  }

  function renderSignin(panel) {
    const setup = S.needsSetup;
    panel.innerHTML = `<p class="eyebrow">Owner</p><h2>${setup ? "Create your password" : "Sign in"}</h2>
      <p class="muted">${setup ? "This is the first visit. Pick the password you'll use to log lighthouses from your phone." : "Sign in to log visits, photos and notes."}</p>
      <form id="auth"><label for="pw">Password</label><input type="password" id="pw" autocomplete="${setup ? "new-password" : "current-password"}" required minlength="${setup ? 10 : 1}">
      <p class="err" id="err" hidden></p>
      <div class="row"><button class="btn primary" type="submit">${setup ? "Set password" : "Sign in"}</button><button class="btn" type="button" id="cancel">Cancel</button></div></form>`;
    $("#pw").focus();
  }

  function renderEdit(panel, l, v) {
    const s = v ? v.status : "toured";
    const existing = v ? v.photos : [];
    panel.innerHTML = header(l) + `<form id="visit">
      <label>How did you visit?</label>
      <div class="seg"><label><input type="radio" name="status" value="toured" ${s !== "seen" ? "checked" : ""}>Toured</label><label><input type="radio" name="status" value="seen" ${s === "seen" ? "checked" : ""}>Seen from shore or boat</label></div>
      <label for="date">Date</label><input type="date" id="date" value="${v ? esc(v.date) : ""}">
      <label for="photo">Photos</label>
      <div class="photos" id="existing">${existing.map((p) => `<div class="ph"><img src="${esc(p.thumb)}" alt=""><button type="button" class="x" data-del="${esc(p.file)}" aria-label="Delete this photo">×</button></div>`).join("")}</div>
      ${existing.length < MAX_PHOTOS ? `<input type="file" id="photo" accept="image/jpeg,image/png,image/webp" multiple>` : `<p class="muted">Delete a photo to add another.</p>`}
      <div class="photos" id="queued"></div>
      <label for="notes">Notes</label><textarea id="notes" placeholder="Write as much as you like. Leave a blank line between paragraphs.">${v ? esc(v.notes) : ""}</textarea>
      <p class="err" id="err" hidden></p>
      <div class="row"><button class="btn primary" type="submit" id="save">Save visit</button><button class="btn" type="button" id="cancel">Cancel</button>
      ${v ? `<button class="btn danger" type="button" id="remove">Remove visit</button>` : ""}</div></form>`;
    queue = [];
  }

  // ---- edit form helpers ----
  let queue = [];
  let confirmRemove = false;
  function showError(msg) { const e = $("#err"); if (e) { e.textContent = msg; e.hidden = !msg; } }
  function renderQueue() {
    const q = $("#queued");
    if (!q) return;
    q.innerHTML = queue.map((f, i) => `<div class="ph"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="x" data-unq="${i}" aria-label="Don't add this photo">×</button></div>`).join("");
  }

  async function saveVisit() {
    const btn = $("#save");
    const id = sel;
    let done = 0;
    busy = true; btn.disabled = true; showError("");
    try {
      btn.textContent = "Saving…";
      let res = await api("save", form({
        id, status: document.querySelector('input[name="status"]:checked').value,
        date: $("#date").value, notes: $("#notes").value,
      }));
      S.visits = res.visits;
      for (let i = 0; i < queue.length; i++) {
        btn.textContent = `Uploading photo ${i + 1} of ${queue.length}…`;
        res = await api("upload", form({ id, photo: queue[i] }));
        S.visits = res.visits;
        done++;
      }
      queue = []; mode = "view"; busy = false; render();
    } catch (e) {
      busy = false; btn.disabled = false; btn.textContent = "Save visit";
      queue = queue.slice(done);
      renderQueue();
      drawMarkers();
      showError(e.message);
    }
  }

  // ---- interactions ----
  function pick(id, fly = true) {
    if (busy) return;
    sel = id; mode = "view"; confirmRemove = false;
    history.replaceState(null, "", `#${id}`);
    render();
    const l = byId(id);
    if (fly && l) map.flyTo([l.lat, l.lon], Math.max(map.getZoom(), 10), { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.8 });
    if (innerWidth <= 820) $("#panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("#list button[data-id]")) return pick(t.closest("button[data-id]").dataset.id);
    if (t.closest("#list button[data-f]")) { filter = t.closest("button[data-f]").dataset.f; return renderList(); }
    if (t.id === "signin") { mode = "signin"; renderPanel(); return $("#panel").scrollIntoView({ block: "start" }); }
    if (t.id === "signout") { await api("logout", form({})).catch(() => {}); return load(); }
    if (t.id === "edit") { mode = "edit"; return renderPanel(); }
    if (t.id === "cancel" && !busy) { mode = "view"; return renderPanel(); }
    if (t.dataset.unq !== undefined) { queue.splice(+t.dataset.unq, 1); return renderQueue(); }
    if (t.dataset.del && !busy) {
      if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = "?"; t.setAttribute("aria-label", "Tap again to delete"); return; }
      busy = true;
      try { S.visits = (await api("delete-photo", form({ id: sel, file: t.dataset.del }))).visits; }
      catch (err) { showError(err.message); }
      busy = false;
      const notes = $("#notes").value, date = $("#date").value, st = document.querySelector('input[name="status"]:checked').value, keep = queue;
      renderEdit($("#panel"), byId(sel), S.visits[sel]);
      $("#notes").value = notes; $("#date").value = date; document.querySelector(`input[name="status"][value="${st}"]`).checked = true;
      queue = keep; renderQueue(); drawMarkers();
      return;
    }
    if (t.id === "remove" && !busy) {
      if (!confirmRemove) { confirmRemove = true; t.textContent = "Tap again to remove the visit and its photos"; return; }
      busy = true;
      try { S.visits = (await api("remove", form({ id: sel }))).visits; mode = "view"; }
      catch (err) { showError(err.message); }
      busy = false; confirmRemove = false; render();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id !== "photo") return;
    const room = MAX_PHOTOS - (S.visits[sel]?.photos.length || 0) - queue.length;
    const files = [...e.target.files];
    queue.push(...files.slice(0, Math.max(0, room)));
    showError(files.length > room ? `Only ${MAX_PHOTOS} photos per lighthouse, so ${files.length - Math.max(0, room)} weren't added.` : "");
    e.target.value = "";
    renderQueue();
  });

  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "visit") return saveVisit();
    if (e.target.id === "auth") {
      try {
        await api(S.needsSetup ? "setup" : "login", form({ password: $("#pw").value }));
        mode = "view";
        await load();
      } catch (err) { showError(err.message); }
    }
  });

  let fitted = false;
  async function load() {
    try {
      S = await api("state");
    } catch (e) {
      $("#panel").innerHTML = `<p class="err">Couldn't load the lighthouse data. ${esc(e.message)}</p>`;
      return;
    }
    if (sel && !byId(sel)) sel = null;
    if (!fitted) { fitted = true; map.fitBounds(L.latLngBounds(S.lighthouses.map((l) => [l.lat, l.lon])).pad(0.08)); }
    render();
  }
  load();
})();
