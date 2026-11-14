// Runs on voiranime.cx episode pages: /anime/<anime-slug>/<episode-slug>/
// On arrival, asks whether the previously opened episode of this anime was finished.

(async () => {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "anime" || parts.length < 3) return; // not an episode page

  const slug = parts[1];
  const epSlug = parts[2];
  const current = readEpisode(epSlug);
  if (!current) return;

  const anime = (await VA.get(slug)) || {
    slug,
    title: "",
    url: location.origin + "/anime/" + slug + "/",
    cover: "",
    lang: "",
    finished: false,
    lastVisited: null,
    watched: {},
  };

  // Refresh metadata from the page every visit.
  anime.title = readTitle() || anime.title || slug;
  const coverUrl = readCover();
  if (coverUrl && (coverUrl !== anime.coverUrl || !anime.cover)) {
    // The site blocks its images outside its own pages (hotlink protection),
    // so download the cover here and keep a small copy as a data URL.
    const thumb = await makeThumbnail(coverUrl);
    if (thumb) {
      anime.cover = thumb;
      anime.coverUrl = coverUrl;
    }
  }
  anime.lang = /-vf\/?$/i.test(location.pathname) ? "VF" : "VOSTFR";

  // Which episode should we ask about?
  // 1. The episode opened just before this one (any navigation: next button, selector, new day...)
  // 2. Otherwise (first visit of this anime), the previous episode linked on the page.
  let candidate = null;
  if (anime.lastVisited && anime.lastVisited.num !== current.num) {
    candidate = anime.lastVisited;
  } else if (!anime.lastVisited) {
    const prev = document.querySelector("a.prev_page");
    if (prev && prev.title) candidate = { num: prev.title.trim(), url: prev.href };
  }

  // Remember where we are, with the link to the next episode (used by the "Continuer" button).
  const next = document.querySelector("a.next_page");
  anime.lastVisited = { num: current.num, url: location.href, nextUrl: next ? next.href : null };
  await VA.save(anime);

  if (!candidate || anime.finished || anime.watched[candidate.num]) return showPill();

  showPrompt(anime, candidate, async (yes) => {
    if (yes) {
      const fresh = (await VA.get(slug)) || anime;
      fresh.watched[candidate.num] = {
        url: candidate.url,
        // The episode right after the candidate: if we came from it in order, it's the current page.
        nextUrl: candidate.nextUrl || location.href,
        at: Date.now(),
      };
      await VA.save(fresh);
    }
    showPill();
  });

  // ---------------------------------------------------------------------------

  function readEpisode(epSlug) {
    // Prefer the selected entry of the episode dropdown (exact number as shown by the site).
    const sel = document.querySelector("select.single-chapter-select option[selected]");
    if (sel && sel.textContent.trim()) return { num: normalizeNum(sel.textContent.trim()) };
    // Fallback: "...-13-vostfr" / "...-12-5-vf"
    const m = epSlug.match(/-(\d+(?:[.-]\d+)?)-(?:vostfr|vf)$/i) || epSlug.match(/-(\d+)$/);
    return m ? { num: normalizeNum(m[1].replace("-", ".")) } : null;
  }

  function normalizeNum(s) {
    const n = parseFloat(s.replace(",", "."));
    return isNaN(n) ? s : String(n);
  }

  function readTitle() {
    const crumbs = document.querySelectorAll(".breadcrumb li a");
    if (crumbs.length >= 2) return crumbs[1].textContent.trim();
    return "";
  }

  function readCover() {
    const og = document.querySelector('meta[property="og:image"]');
    return og ? og.content : "";
  }

  async function makeThumbnail(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      const w = 160;
      const h = Math.round((bmp.height / bmp.width) * w);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.8);
    } catch {
      return null;
    }
  }

  // Small button to mark the episode on screen as watched right away
  // (e.g. the latest episode out: there is no "next" page to trigger the question).
  async function showPill() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .pill {
          display: flex; align-items: center; gap: 2px; padding: 4px;
          background: rgba(20, 11, 6, .55);
          backdrop-filter: blur(18px) saturate(170%);
          -webkit-backdrop-filter: blur(18px) saturate(170%);
          border: 1px solid rgba(255,255,255,.16); border-radius: 999px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 10px 30px rgba(0,0,0,.4);
          font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          animation: in .3s cubic-bezier(.2,.9,.3,1.2);
        }
        @keyframes in { from { transform: translateY(16px); opacity: 0; } }
        svg { display: block; flex-shrink: 0; }
        button { font: inherit; cursor: pointer; border: 0; padding: 0; }
        .mark {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 14px 8px 10px; border-radius: 999px;
          color: #fff7f0; background: rgba(255,255,255,.08);
          transition: background .2s, filter .2s;
        }
        .mark:hover { background: rgba(255,255,255,.16); }
        .mark.done {
          color: #fff;
          background: linear-gradient(145deg, rgba(251,146,60,.95), rgba(234,88,12,.95));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
        }
        .mark.done:hover { filter: brightness(1.08); }
        .close {
          display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%;
          background: none; color: rgba(255,237,222,.6);
        }
        .close:hover { background: rgba(255,255,255,.14); color: #fff; }
      </style>
      <div class="pill">
        <button class="mark"></button>
        <button class="close" title="Masquer"></button>
      </div>`;
    const mark = root.querySelector(".mark");
    root.querySelector(".close").append(lucide("x", 14));
    root.querySelector(".close").addEventListener("click", () => host.remove());

    const render = (seen) => {
      mark.className = "mark" + (seen ? " done" : "");
      mark.title = seen ? "Retirer des épisodes vus" : "Ajouter l'anime à ta liste et marquer cet épisode comme vu";
      mark.replaceChildren(
        lucide(seen ? "circle-check-big" : "circle-plus", 16),
        seen ? `Épisode ${current.num} vu` : `Marquer l'ép. ${current.num} comme vu`
      );
    };
    mark.addEventListener("click", async () => {
      const fresh = (await VA.get(slug)) || anime;
      const seen = !!fresh.watched[current.num];
      if (seen) delete fresh.watched[current.num];
      else {
        const next = document.querySelector("a.next_page");
        fresh.watched[current.num] = { url: location.href, nextUrl: next ? next.href : null, at: Date.now() };
      }
      await VA.save(fresh);
      render(!seen);
    });

    const fresh = (await VA.get(slug)) || anime;
    render(!!fresh.watched[current.num]);
    document.body.appendChild(host);
  }

  function showPrompt(anime, ep, onAnswer) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          position: relative; overflow: hidden;
          display: flex; gap: 14px; align-items: center;
          width: 350px; padding: 14px;
          color: #fff7f0;
          background:
            radial-gradient(circle at 0% 0%, rgba(249,115,22,.35), transparent 55%),
            radial-gradient(circle at 100% 100%, rgba(194,65,12,.35), transparent 55%),
            rgba(20, 11, 6, .45);
          backdrop-filter: blur(22px) saturate(170%);
          -webkit-backdrop-filter: blur(22px) saturate(170%);
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 22px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 16px 44px rgba(0,0,0,.45);
          font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          animation: in .35s cubic-bezier(.2,.9,.3,1.2);
        }
        @keyframes in { from { transform: translateY(24px) scale(.97); opacity: 0; } }
        svg { display: block; flex-shrink: 0; }
        .cover {
          width: 64px; height: 90px; object-fit: cover; border-radius: 14px; flex-shrink: 0;
          display: grid; place-items: center; color: rgba(255,237,222,.62);
          background: rgba(255,255,255,.08);
          box-shadow: 0 6px 18px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.14);
        }
        .body { flex: 1; min-width: 0; }
        .title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 22px; text-shadow: 0 1px 8px rgba(0,0,0,.4); }
        .meta { display: flex; align-items: center; gap: 6px; color: rgba(255,237,222,.7); font-size: 12px; margin: 4px 0 8px; }
        .pill {
          padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
          background: rgba(249,115,22,.22); color: #fed7aa; border: 1px solid rgba(251,146,60,.35);
        }
        .q { margin-bottom: 10px; }
        .q b { color: #fed7aa; }
        .btns { display: flex; gap: 8px; }
        button { font: inherit; cursor: pointer; border: 0; }
        .yes, .no {
          flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 8px 0; border-radius: 999px; font-weight: 700; transition: filter .2s, background .2s;
        }
        .yes {
          color: #fff;
          background: linear-gradient(145deg, rgba(251,146,60,.95), rgba(234,88,12,.95));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 6px 16px rgba(234,88,12,.45);
        }
        .yes:hover { filter: brightness(1.08); }
        .no {
          color: #fff7f0; background: rgba(255,255,255,.1);
          border: 1px solid rgba(255,255,255,.16); box-shadow: inset 0 1px 0 rgba(255,255,255,.2);
        }
        .no:hover { background: rgba(255,255,255,.18); }
        .close {
          position: absolute; top: 10px; right: 10px;
          display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
          background: none; color: rgba(255,237,222,.7); padding: 0;
        }
        .close:hover { background: rgba(255,255,255,.14); color: #fff; }
      </style>
      <div class="card">
        <button class="close" title="Fermer"></button>
        <div class="cover"></div>
        <div class="body">
          <div class="title"></div>
          <div class="meta"><span class="pill"></span><span class="count"></span></div>
          <div class="q">As-tu fini l'<b></b> ?</div>
          <div class="btns">
            <button class="yes">Oui</button>
            <button class="no">Non</button>
          </div>
        </div>
      </div>`;

    const coverEl = root.querySelector(".cover");
    if (anime.cover) {
      const img = document.createElement("img");
      img.className = "cover";
      img.src = anime.cover;
      coverEl.replaceWith(img);
    } else {
      coverEl.append(lucide("tv-minimal-play", 24));
    }
    root.querySelector(".title").textContent = anime.title;
    root.querySelector(".pill").textContent = anime.lang;
    const count = Object.keys(anime.watched).length;
    root.querySelector(".count").textContent = `${count} épisode${count > 1 ? "s" : ""} vu${count > 1 ? "s" : ""}`;
    root.querySelector(".q b").textContent = `épisode ${ep.num}`;
    root.querySelector(".yes").prepend(lucide("check", 16, 2.5));
    root.querySelector(".no").prepend(lucide("x", 16, 2.5));
    root.querySelector(".close").append(lucide("x", 14));

    const close = (answer) => {
      host.remove();
      onAnswer(answer);
    };
    root.querySelector(".yes").addEventListener("click", () => close(true));
    root.querySelector(".no").addEventListener("click", () => close(false));
    root.querySelector(".close").addEventListener("click", () => close(false));

    document.body.appendChild(host);
  }
})();
