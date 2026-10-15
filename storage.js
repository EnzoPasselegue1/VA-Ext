// Shared storage helpers (used by content.js and popup.js).
//
// An anime as seen by the rest of the code:
// {
//   slug, title, url, cover, coverUrl, lang, finished, favorite, updatedAt,
//   tags: ["<custom filter name>", ...],
//   lastVisited: { num, url, nextUrl },
//   watched: { "<num>": { url, nextUrl, at } }
// }
//
// It is split across two storages:
// - chrome.storage.sync, key "s:<slug>": the progress, in a compact form (see pack()).
//   Chrome syncs it between computers signed in to the same Google account.
//   Small quota (~100 KB total, 8 KB per anime), so no images and no per-episode links.
// - chrome.storage.local, key "anime:<slug>": the full record, including the cover
//   image and episode links. Only on this computer.
// The synced copy is the reference; local adds the extras it doesn't carry.
// If a sync write fails (quota), the local record is flagged "unsynced" and kept.

const ORIGIN = "https://voir-anime.to";

const VA = {
  key(slug) {
    return "anime:" + slug;
  },

  syncKey(slug) {
    return "s:" + slug;
  },

  async get(slug) {
    await VA.migrate();
    const [l, s] = await Promise.all([
      chrome.storage.local.get(VA.key(slug)),
      chrome.storage.sync.get(VA.syncKey(slug)),
    ]);
    return VA.pick(slug, s[VA.syncKey(slug)], l[VA.key(slug)]);
  },

  // Synced copy + local extras, unless the local one is newer and failed to sync.
  // null when only a local copy remains without "unsynced": deleted on another computer.
  pick(slug, synced, local) {
    if (local && local.unsynced && (!synced || local.updatedAt >= synced.u)) return local;
    return synced ? VA.merge(slug, synced, local) : null;
  },

  // touch=false keeps the "last activity" date (used for favorites/filters edits)
  async save(anime, touch = true) {
    if (touch) anime.updatedAt = Date.now();
    try {
      await chrome.storage.sync.set({ [VA.syncKey(anime.slug)]: VA.pack(anime) });
      delete anime.unsynced;
    } catch (e) {
      console.warn("VA Tracker: sync failed, kept on this computer only", e);
      anime.unsynced = true;
    }
    await chrome.storage.local.set({ [VA.key(anime.slug)]: anime });
  },

  async remove(slug) {
    await Promise.all([
      chrome.storage.local.remove(VA.key(slug)),
      chrome.storage.sync.remove(VA.syncKey(slug)),
    ]);
  },

  async all() {
    await VA.migrate();
    const [local, synced] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]);
    const out = [];
    const stale = [];
    for (const [k, s] of Object.entries(synced)) {
      if (!k.startsWith("s:")) continue;
      const slug = k.slice(2);
      out.push(VA.pick(slug, s, local[VA.key(slug)]));
    }
    for (const [k, a] of Object.entries(local)) {
      if (!k.startsWith("anime:") || synced[VA.syncKey(a.slug)]) continue;
      // Local only: either sync failed (keep it), or it was deleted on another computer.
      if (a.unsynced) out.push(a);
      else stale.push(k);
    }
    if (stale.length) chrome.storage.local.remove(stale);
    return out;
  },

  // One-time: push records created before sync existed (or after a failed sync).
  async migrate() {
    const local = await chrome.storage.local.get(null);
    if (local["va:migrated"]) {
      // Retry the ones that failed to sync earlier
      for (const [k, a] of Object.entries(local)) if (k.startsWith("anime:") && a.unsynced) await VA.save(a, false);
      return;
    }
    const synced = await chrome.storage.sync.get(null);
    for (const [k, a] of Object.entries(local)) {
      if (!k.startsWith("anime:")) continue;
      const s = synced[VA.syncKey(a.slug)];
      if (!s || s.u < a.updatedAt) await VA.save(a, false);
    }
    await chrome.storage.local.set({ "va:migrated": true });
  },

  // Compact synced form. Episode links aren't synced; watched = "num:seconds36,num:seconds36"
  pack(a) {
    const p = { t: a.title, l: a.lang, u: a.updatedAt };
    if (a.finished) p.f = 1;
    if (a.favorite) p.v = 1;
    if (a.tags && a.tags.length) p.g = a.tags;
    if (a.lastVisited) p.lv = [a.lastVisited.num, path(a.lastVisited.url), path(a.lastVisited.nextUrl)];
    p.w = Object.entries(a.watched || {})
      .map(([n, w]) => n + ":" + Math.round((w.at || 0) / 1000).toString(36))
      .join(",");
    return p;

    function path(u) {
      return u ? u.replace(ORIGIN, "") : "";
    }
  },

  merge(slug, p, local) {
    local = local || {};
    const url = (path) => (path ? ORIGIN + path : null);
    const watched = {};
    (p.w ? p.w.split(",") : []).forEach((item) => {
      const [n, t] = item.split(":");
      const extra = (local.watched || {})[n] || {};
      watched[n] = { url: extra.url || null, nextUrl: extra.nextUrl || null, at: parseInt(t, 36) * 1000 };
    });
    return {
      slug,
      title: p.t || local.title || slug,
      url: ORIGIN + "/anime/" + slug + "/",
      cover: local.cover || "",
      coverUrl: local.coverUrl || "",
      lang: p.l || local.lang || "",
      finished: !!p.f,
      favorite: !!p.v,
      tags: p.g || [],
      updatedAt: p.u || 0,
      lastVisited: p.lv ? { num: p.lv[0], url: url(p.lv[1]), nextUrl: url(p.lv[2]) } : null,
      watched,
    };
  },

  // Bytes used / total of the synced storage
  async syncUsage() {
    return { used: await chrome.storage.sync.getBytesInUse(null), total: chrome.storage.sync.QUOTA_BYTES };
  },

  // Custom filters exist as long as at least one anime uses them
  tags(animes) {
    const set = new Set(animes.flatMap((a) => a.tags || []));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  },

  sortedEpisodes(anime) {
    return Object.keys(anime.watched || {}).sort((a, b) => parseFloat(a) - parseFloat(b));
  },

  lastWatched(anime) {
    const eps = VA.sortedEpisodes(anime);
    return eps.length ? eps[eps.length - 1] : null;
  },
};
