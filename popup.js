const homeEl = document.getElementById("home");
const detailEl = document.getElementById("detail");
const listEl = document.getElementById("list");
const detailBody = document.getElementById("detail-body");
const searchEl = document.getElementById("search");
const statsEl = document.getElementById("stats");
const statsBody = document.getElementById("stats-body");
const filtersEl = document.getElementById("filters");
let tab = "progress";
let filter = "all"; // "all" | "fav" | "tag:<name>"
let detailFrom = "home"; // screen the "back" button of the detail screen returns to

// Static icons declared in popup.html with data-icon="name"
document.querySelectorAll("[data-icon]").forEach((n) =>
  n.prepend(lucide(n.dataset.icon, Number(n.dataset.size) || 16))
);

document.querySelectorAll(".tabs button").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tab = btn.dataset.tab;
    renderHome();
  })
);
searchEl.addEventListener("input", renderHome);
document.getElementById("back").addEventListener("click", () =>
  detailFrom === "stats" ? showStats() : showHome()
);
document.getElementById("open-stats").addEventListener("click", showStats);
document.getElementById("stats-back").addEventListener("click", showHome);

// ---- Screen 1: series list ----

function showHome() {
  detailEl.hidden = true;
  statsEl.hidden = true;
  homeEl.hidden = false;
  renderHome();
}

async function renderHome() {
  const q = searchEl.value.trim().toLowerCase();
  const all = await VA.all();
  renderFilters(all);
  const animes = all
    .filter((a) => (tab === "finished" ? a.finished : !a.finished))
    .filter((a) => !q || a.title.toLowerCase().includes(q))
    .filter(matchesFilter)
    // Favorites first, then most recent activity
    .sort((a, b) => !!b.favorite - !!a.favorite || b.updatedAt - a.updatedAt);

  listEl.replaceChildren();
  if (!animes.length) {
    listEl.append(
      empty(
        q ? "search" : filter !== "all" ? "tag" : tab === "finished" ? "circle-check-big" : "popcorn",
        q
          ? "Aucun résultat."
          : filter !== "all"
            ? "Aucun anime dans ce filtre."
            : tab === "finished"
              ? "Aucun anime terminé pour l'instant."
              : "Ouvre un épisode sur voir-anime.to pour commencer."
      )
    );
    return;
  }
  animes.forEach((a) => listEl.append(row(a)));
}

function matchesFilter(anime) {
  if (filter === "fav") return !!anime.favorite;
  if (filter.startsWith("tag:")) return (anime.tags || []).includes(filter.slice(4));
  return true;
}

// Chip row: Tous / Favoris / one chip per custom filter. Hidden until there is something to filter on.
function renderFilters(all) {
  const tags = VA.tags(all);
  if (filter.startsWith("tag:") && !tags.includes(filter.slice(4))) filter = "all";
  const hasFav = all.some((a) => a.favorite);
  filtersEl.hidden = !hasFav && !tags.length && filter === "all";
  filtersEl.replaceChildren();
  const chip = (value, label, icon) => {
    const c = el("button", "chip" + (filter === value ? " active" : ""));
    if (icon) c.append(lucide(icon, 13));
    c.append(label);
    c.addEventListener("click", () => {
      filter = filter === value && value !== "all" ? "all" : value;
      renderHome();
    });
    return c;
  };
  filtersEl.append(chip("all", "Tous"), chip("fav", "Favoris", "star"));
  tags.forEach((t) => filtersEl.append(chip("tag:" + t, t, "tag")));
}

function row(anime) {
  const root = el("div", "anime");
  const info = el("div", "info");
  const title = el("div", "title");
  title.textContent = anime.title;
  info.append(title, meta(anime));
  const chevron = el("span", "chevron");
  chevron.append(lucide("chevron-right", 18));
  const side = el("div", "side");
  side.append(favButton(anime, renderHome), chevron);

  root.append(cover(anime, 18), info, side);
  root.addEventListener("click", () => showDetail(anime.slug, "home"));
  return root;
}

function meta(anime) {
  const eps = VA.sortedEpisodes(anime);
  const last = VA.lastWatched(anime);
  const m = el("div", "meta");
  const lang = el("span", "pill");
  lang.textContent = anime.lang;
  const txt = el("span");
  if (last) {
    txt.append("Dernier vu ");
    const b = el("b");
    b.textContent = "ép. " + last;
    txt.append(b, ` · ${eps.length} vu${eps.length > 1 ? "s" : ""}`);
  } else {
    txt.textContent = "Aucun épisode marqué";
  }
  m.append(lang, txt);
  return m;
}

// ---- Screen 2: one series ----

async function showDetail(slug, from = detailFrom) {
  detailFrom = from;
  const anime = await VA.get(slug);
  if (!anime) return showHome();
  homeEl.hidden = true;
  statsEl.hidden = true;
  detailEl.hidden = false;
  detailBody.replaceChildren(detail(anime));
  window.scrollTo(0, 0);
}

function detail(anime) {
  const eps = VA.sortedEpisodes(anime);
  const last = VA.lastWatched(anime);
  const root = el("div");

  // Cover + title + "Anime terminé" toggle
  const hero = el("div", "hero");
  const heroInfo = el("div", "hero-info");
  const title = el("div", "hero-title");
  const link = el("a");
  link.href = anime.url;
  link.target = "_blank";
  link.title = "Ouvrir la page de l'anime sur le site";
  link.textContent = anime.title;
  title.append(link, favButton(anime, () => showDetail(anime.slug)));

  const done = el("label", "done" + (anime.finished ? " checked" : ""));
  const check = el("input");
  check.type = "checkbox";
  check.checked = !!anime.finished;
  const box = el("span", "box");
  box.append(lucide("check", 14, 3));
  done.append(check, box, document.createTextNode("Anime terminé"));
  check.addEventListener("change", async () => {
    anime.finished = check.checked;
    await VA.save(anime);
    showDetail(anime.slug);
  });

  heroInfo.append(title, meta(anime), done);
  hero.append(cover(anime, 28), heroInfo);

  // Continue / delete
  const actions = el("div", "actions");
  // Episode links aren't synced: on another computer, fall back to the last visited page
  const lv = anime.lastVisited;
  const nextUrl = (last && anime.watched[last].nextUrl) || (lv && ((lv.num === last && lv.nextUrl) || lv.url));
  if (nextUrl && !anime.finished) {
    const cont = el("a", "btn primary");
    cont.href = nextUrl;
    cont.target = "_blank";
    cont.append(lucide("play", 14), last ? "Continuer" : "Reprendre");
    actions.append(cont);
  }
  const del = el("button", "btn danger");
  del.title = "Supprimer cet anime et son historique";
  del.append(lucide("trash-2", 14), "Supprimer");
  del.addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${anime.title} » et tout son historique ?`)) return;
    await VA.remove(anime.slug);
    showHome();
  });
  actions.append(del);

  // Custom filters: toggle existing ones, or create a new one
  const tagsH = section("Filtres");
  const tagsBox = el("div", "chips tag-editor");
  VA.all().then((all) => {
    const mine = anime.tags || [];
    VA.tags(all).forEach((t) => {
      const c = el("button", "chip" + (mine.includes(t) ? " active" : ""));
      c.append(lucide("tag", 13), t);
      c.title = mine.includes(t) ? "Retirer ce filtre" : "Ajouter ce filtre";
      c.addEventListener("click", () => setTags(anime, mine.includes(t) ? mine.filter((x) => x !== t) : [...mine, t]));
      tagsBox.append(c);
    });
    const add = el("button", "chip add");
    add.append(lucide("plus", 13), "Nouveau");
    add.addEventListener("click", () => {
      const input = el("input", "chip-input");
      input.placeholder = "Nom du filtre…";
      input.maxLength = 24;
      add.replaceWith(input);
      input.focus();
      let closed = false; // Enter/Escape re-render, which can also fire "blur"
      const commit = (save) => {
        if (closed) return;
        closed = true;
        const name = input.value.trim();
        if (save && name && !mine.includes(name)) setTags(anime, [...mine, name]);
        else showDetail(anime.slug);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit(true);
        if (e.key === "Escape") commit(false);
      });
      input.addEventListener("blur", () => commit(true));
    });
    tagsBox.append(add);
  });

  // Watched episodes, most recent first
  const h2 = el("h2");
  const h2txt = el("span");
  h2txt.textContent = "Épisodes vus";
  const count = el("span", "pill");
  count.textContent = eps.length;
  h2.append(h2txt, count);

  const list = el("div", "eps");
  // Last opened episode not marked yet (e.g. latest episode out, no "next" page to trigger the question)
  if (lv && !anime.watched[lv.num]) {
    const mark = el("button", "mark-last");
    mark.title = "Dernier épisode ouvert sur le site";
    mark.append(lucide("circle-plus", 16), `Marquer l'ép. ${lv.num} comme vu`);
    mark.addEventListener("click", async () => {
      anime.watched[lv.num] = { url: lv.url, nextUrl: lv.nextUrl, at: Date.now() };
      await VA.save(anime);
      showDetail(anime.slug);
    });
    list.append(mark);
  }
  if (!eps.length) {
    const none = el("div", "no-eps");
    none.textContent = "Aucun épisode marqué comme vu.";
    list.append(none);
  }
  eps.reverse().forEach((num) => {
    const item = el("div", "ep");
    const ok = el("span", "ok");
    ok.append(lucide("circle-check-big", 16));
    const a = el("a");
    a.href = anime.watched[num].url || anime.url;
    a.target = "_blank";
    a.textContent = "Épisode " + num;
    const date = el("span", "date");
    date.append(lucide("calendar", 12), new Date(anime.watched[num].at).toLocaleDateString("fr-FR"));
    const x = el("button", "remove");
    x.title = "Retirer des épisodes vus";
    x.append(lucide("x", 14));
    x.addEventListener("click", async () => {
      delete anime.watched[num];
      await VA.save(anime);
      showDetail(anime.slug);
    });
    item.append(ok, a, date, x);
    list.append(item);
  });

  root.append(hero, actions, tagsH, tagsBox, h2, list);
  return root;
}

// ---- Screen 3: recap ----

const MIN_PER_EPISODE = 23; // typical anime episode length, used for the time estimate
const DAY = 86400000;

async function showStats() {
  const animes = await VA.all();
  homeEl.hidden = true;
  detailEl.hidden = true;
  statsEl.hidden = false;
  statsBody.replaceChildren(stats(animes), await syncInfo(animes));
  window.scrollTo(0, 0);
}

function stats(animes) {
  const root = el("div");
  const views = animes.flatMap((a) => Object.values(a.watched || {}).map((w) => w.at).filter(Boolean));
  const totalEps = animes.reduce((n, a) => n + Object.keys(a.watched || {}).length, 0);
  const finished = animes.filter((a) => a.finished).length;
  const today = dayStart(Date.now());

  // Episodes per day, last 14 days (index 13 = today)
  const perDay = new Array(14).fill(0);
  views.forEach((at) => {
    const i = 13 - Math.round((today - dayStart(at)) / DAY);
    if (i >= 0 && i < 14) perDay[i]++;
  });
  const week = perDay.slice(7).reduce((a, b) => a + b, 0);

  // Streak: consecutive days with at least one episode, ending today (or yesterday)
  const days = new Set(views.map(dayStart));
  let streak = 0;
  for (let d = days.has(today) ? today : today - DAY; days.has(d); d -= DAY) streak++;

  const tiles = el("div", "tiles");
  tiles.append(
    tile("tv", animes.length - finished, "En cours"),
    tile("circle-check-big", finished, "Finis"),
    tile("play", totalEps, totalEps > 1 ? "Épisodes vus" : "Épisode vu"),
    tile("clock", duration(totalEps * MIN_PER_EPISODE), "Temps estimé"),
    tile("calendar", week, "Cette semaine"),
    tile("flame", streak, streak > 1 ? "Jours d'affilée" : "Jour d'affilée")
  );
  root.append(tiles);

  if (!animes.length) {
    root.append(empty("popcorn", "Ouvre un épisode sur voir-anime.to pour commencer."));
    return root;
  }

  root.append(section("Activité · 14 derniers jours"), activity(perDay, today));

  const top = animes
    .map((a) => ({ a, n: Object.keys(a.watched || {}).length }))
    .filter((t) => t.n)
    .sort((x, y) => y.n - x.n)
    .slice(0, 5);
  if (top.length) {
    root.append(section("Les plus regardés"));
    const list = el("div", "top");
    top.forEach(({ a, n }) => {
      const item = el("div", "top-item");
      item.title = "Voir les épisodes";
      const name = el("div", "top-name");
      const t = el("span");
      t.textContent = a.title;
      const c = el("b");
      c.textContent = n + " ép.";
      name.append(t, c);
      const track = el("div", "track");
      const bar = el("div", "fill");
      bar.style.width = (n / top[0].n) * 100 + "%";
      track.append(bar);
      item.append(cover(a, 14), el("div", "top-body"));
      item.lastChild.append(name, track);
      item.addEventListener("click", () => showDetail(a.slug, "stats"));
      list.append(item);
    });
    root.append(list);
  }
  return root;
}

// Sync status: quota used, and animes too big to sync (kept on this computer only)
async function syncInfo(animes) {
  const box = el("div", "sync-info");
  const { used, total } = await VA.syncUsage();
  const line = el("div");
  line.append(lucide("cloud", 13), `Synchro Google : ${Math.ceil(used / 1024)} Ko / ${Math.round(total / 1024)} Ko`);
  const track = el("div", "track");
  const bar = el("div", "fill");
  bar.style.width = Math.min((used / total) * 100, 100) + "%";
  track.append(bar);
  box.append(line, track);
  const unsynced = animes.filter((a) => a.unsynced);
  if (unsynced.length) {
    const warn = el("div", "sync-warn");
    warn.append(
      lucide("cloud-off", 13),
      `Pas synchronisé (trop gros) : ${unsynced.map((a) => a.title).join(", ")}. Gardé sur cet ordi uniquement.`
    );
    box.append(warn);
  }
  return box;
}

function tile(icon, value, label) {
  const t = el("div", "tile");
  const i = el("span", "tile-icon");
  i.append(lucide(icon, 15));
  const v = el("div", "tile-value");
  v.textContent = value;
  const l = el("div", "tile-label");
  l.textContent = label;
  t.append(i, v, l);
  return t;
}

function section(text) {
  const h = el("h2");
  const s = el("span");
  s.textContent = text;
  h.append(s);
  return h;
}

function activity(perDay, today) {
  const max = Math.max(...perDay);
  const box = el("div", "chart");
  const bars = el("div", "bars");
  const tip = el("div", "tip");
  tip.hidden = true;
  perDay.forEach((n, i) => {
    const date = new Date(today - (13 - i) * DAY);
    const col = el("div", "col");
    const bar = el("div", "bar" + (n ? "" : " zero"));
    bar.style.height = max ? Math.max((n / max) * 100, n ? 6 : 0) + "%" : "0";
    col.append(bar);
    col.addEventListener("mouseenter", () => {
      tip.textContent =
        date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) +
        " · " + n + " épisode" + (n > 1 ? "s" : "");
      tip.hidden = false;
      // Center on the bar, but keep the tooltip inside the chart
      const half = tip.offsetWidth / 2;
      const x = col.offsetLeft + col.offsetWidth / 2;
      tip.style.left = Math.min(Math.max(x, half + 4), box.clientWidth - half - 4) + "px";
      col.classList.add("hover");
    });
    col.addEventListener("mouseleave", () => {
      tip.hidden = true;
      col.classList.remove("hover");
    });
    bars.append(col);
  });
  const axis = el("div", "axis");
  [13, 6, 0].forEach((back) => {
    const s = el("span");
    s.textContent = back ? new Date(today - back * DAY).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "Auj.";
    axis.append(s);
  });
  const peak = el("div", "peak");
  peak.textContent = max ? "max " + max : "Aucun épisode sur la période";
  box.append(peak, bars, tip, axis);
  return box;
}

function dayStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function duration(min) {
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  if (h < 48) return h + " h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") : "");
  return Math.round(h / 24) + " j";
}

// ---- Backup: export / import all data as JSON ----

document.getElementById("export").addEventListener("click", async () => {
  const data = await VA.all();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `va-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("format");
    for (const a of data) if (a && a.slug) await VA.save(a, false);
    renderHome();
  } catch {
    alert("Fichier invalide.");
  }
  e.target.value = "";
});

// ---- Helpers ----

function cover(anime, iconSize) {
  // Only data: URLs work here (the site blocks direct image loading).
  if (anime.cover && anime.cover.startsWith("data:")) {
    const img = el("img", "cover");
    img.src = anime.cover;
    return img;
  }
  const ph = el("span", "cover placeholder");
  ph.append(lucide("tv-minimal-play", iconSize));
  return ph;
}

function favButton(anime, refresh) {
  const b = el("button", "fav" + (anime.favorite ? " on" : ""));
  b.title = anime.favorite ? "Retirer des favoris" : "Ajouter aux favoris";
  b.append(lucide("star", 17));
  b.addEventListener("click", async (e) => {
    e.stopPropagation(); // don't open the series when clicking the star in the list
    anime.favorite = !anime.favorite;
    await VA.save(anime, false);
    refresh();
  });
  return b;
}

async function setTags(anime, tags) {
  anime.tags = tags;
  await VA.save(anime, false);
  showDetail(anime.slug);
}

function empty(icon, text) {
  const box = el("div", "empty");
  const bubble = el("span", "bubble");
  bubble.append(lucide(icon, 24));
  const p = el("div");
  p.textContent = text;
  box.append(bubble, p);
  return box;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

renderHome();
