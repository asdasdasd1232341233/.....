// ----------------------------
// 1) SUPABASE CONFIG (EDIT ME)
// ----------------------------
// Paste from Supabase: Project Settings -> API
const SUPABASE_URL = "https://mvrfiptqfrsklhoqwctk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_t57wbZarflBWQOsvJizRDg_MwHe7LgZ";

const BUCKET = "memories";
const FOLDER = "uploads";
const CAPTIONS_TABLE = "captions";

// ----------------------------
// DOM
// ----------------------------
const fileInput = document.getElementById("fileInput");
const gallery = document.getElementById("gallery");
const tpl = document.getElementById("cardTpl");
const refreshBtn = document.getElementById("refreshBtn");
const clearLocalBtn = document.getElementById("clearLocalBtn");
const statusText = document.getElementById("statusText");
document.getElementById("year").textContent = new Date().getFullYear();

// Lightbox
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxVideo = document.getElementById("lightboxVideo");
const lightboxClose = document.getElementById("lightboxClose");

// ----------------------------
// Supabase client
// ----------------------------
let supabaseClient = null;

// Cache
const CACHE_KEY = "imissyou_shared_cache_v2";

// ----------------------------
// Helpers
// ----------------------------
function setStatus(msg, isError = false) {
  statusText.textContent = msg;
  statusText.style.color = isError
    ? "rgba(255,77,109,0.95)"
    : "rgba(255,255,255,0.75)";
}

function isPlaceholderConfig() {
  return (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes("PASTE_") ||
    SUPABASE_ANON_KEY.includes("PASTE_")
  );
}

function isVideoName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ["mp4", "webm", "mov", "m4v", "ogg"].includes(ext);
}

function safeName(originalName) {
  const ext = originalName.includes(".") ? "." + originalName.split(".").pop() : "";
  const base = crypto.randomUUID();
  return `${Date.now()}_${base}${ext}`;
}

function publicUrlFor(path) {
  const { data } = supabaseClient.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ----------------------------
// Lightbox
// ----------------------------
function lightboxShowImage(src, alt) {
  lightboxVideo.pause();
  lightboxVideo.removeAttribute("src");
  lightboxVideo.load();

  lightboxImg.src = src;
  lightboxImg.alt = alt || "Image";

  lightboxImg.classList.add("show-img");
  lightboxVideo.classList.remove("show-video");

  lightbox.classList.add("open");
  lightbox.setAttribute("aria-hidden", "false");
}

function lightboxShowVideo(src) {
  lightboxImg.removeAttribute("src");
  lightboxImg.classList.remove("show-img");

  lightboxVideo.src = src;
  lightboxVideo.classList.add("show-video");

  lightbox.classList.add("open");
  lightbox.setAttribute("aria-hidden", "false");
}

function closeLightbox() {
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden", "true");

  lightboxVideo.pause();
  lightboxVideo.removeAttribute("src");
  lightboxVideo.load();

  lightboxImg.removeAttribute("src");
  lightboxImg.classList.remove("show-img");
  lightboxVideo.classList.remove("show-video");
}

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lightbox.classList.contains("open")) closeLightbox();
});

// ----------------------------
// Init
// ----------------------------
init();

async function init() {
  if (isPlaceholderConfig()) {
    setStatus("Paste your Supabase Project URL + Publishable API Key in script.js", true);
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    setStatus("Supabase library didn't load. Check the CDN script tag in index.html.", true);
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error(e);
    setStatus("Could not create Supabase client. Check URL/key.", true);
    return;
  }

  const cached = loadCache();
  if (cached?.length) render(cached);

  setStatus("Connected. Loading…");
  await refreshGallery();
}

// ----------------------------
// Events
// ----------------------------
fileInput.addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  fileInput.value = "";
  await uploadFiles(files);
});

refreshBtn.addEventListener("click", refreshGallery);

clearLocalBtn.addEventListener("click", () => {
  localStorage.removeItem(CACHE_KEY);
  setStatus("Local cache cleared. Click Refresh.");
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragover");
});
window.addEventListener("dragleave", () => {
  document.body.classList.remove("dragover");
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dragover");
  const files = [...(e.dataTransfer?.files || [])];
  await uploadFiles(files);
});

// ----------------------------
// Upload
// ----------------------------
async function uploadFiles(files) {
  if (!supabaseClient) return;
  if (!files.length) return;

  const accepted = files.filter(
    (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
  );

  if (!accepted.length) {
    setStatus("Only images/videos are allowed.", true);
    return;
  }

  setStatus(`Uploading ${accepted.length} file(s)…`);

  for (const file of accepted) {
    const filename = safeName(file.name);
    const path = `${FOLDER}/${filename}`;

    const { error } = await supabaseClient.storage
      .from(BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
      });

    if (error) {
      console.error(error);
      setStatus(`Upload failed: ${error.message}`, true);
      return;
    }
  }

  setStatus("Upload complete. Refreshing…");
  await refreshGallery();
}

// ----------------------------
// Captions: load map {path -> caption}
// ----------------------------
async function fetchCaptions(paths) {
  if (!paths.length) return new Map();

  const { data, error } = await supabaseClient
    .from(CAPTIONS_TABLE)
    .select("path, caption")
    .in("path", paths);

  if (error) {
    console.warn("Could not fetch captions:", error.message);
    return new Map();
  }

  const map = new Map();
  for (const row of data || []) {
    map.set(row.path, row.caption || "");
  }
  return map;
}

async function upsertCaption(path, caption) {
  const { error } = await supabaseClient
    .from(CAPTIONS_TABLE)
    .upsert({ path, caption }, { onConflict: "path" });

  if (error) {
    throw new Error(error.message);
  }
}

// ----------------------------
// List files
// ----------------------------
async function refreshGallery() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient.storage
    .from(BUCKET)
    .list(FOLDER, {
      limit: 200,
      sortBy: { column: "created_at", order: "desc" }
    });

  if (error) {
    console.error(error);
    setStatus(`Could not load gallery: ${error.message}`, true);
    return;
  }

  const items = (data || [])
    .filter((x) => x?.name && x.name !== ".emptyFolderPlaceholder")
    .map((x) => {
      const path = `${FOLDER}/${x.name}`;
      return {
        name: x.name,
        path,
        url: publicUrlFor(path),
        type: isVideoName(x.name) ? "video" : "image",
        caption: ""
      };
    });

  // Fetch captions for these items
  const captionMap = await fetchCaptions(items.map(i => i.path));
  for (const item of items) {
    item.caption = captionMap.get(item.path) || "";
  }

  saveCache(items);
  render(items);

  setStatus(items.length ? `Loaded ${items.length} item(s).` : "No uploads yet.");
}

// ----------------------------
// Delete file (shared)
// ----------------------------
async function deleteItem(path) {
  const ok = confirm("Delete this for everyone?");
  if (!ok) return;

  setStatus("Deleting…");

  const { error } = await supabaseClient.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error(error);
    setStatus(`Delete failed: ${error.message}`, true);
    return;
  }

  // also delete caption row (optional)
  await supabaseClient.from(CAPTIONS_TABLE).delete().eq("path", path);

  setStatus("Deleted. Refreshing…");
  await refreshGallery();
}

// ----------------------------
// Render
// ----------------------------
function render(items) {
  gallery.innerHTML = "";

  if (!items.length) {
    gallery.innerHTML = `
      <div class="panel" style="grid-column: 1 / -1; text-align:center;">
        <p style="margin: 6px 0 0; color: rgba(255,255,255,0.75);">
          Nothing here yet. Upload something.
        </p>
      </div>
    `;
    return;
  }

  for (const item of items) {
    const node = tpl.content.cloneNode(true);
    const thumb = node.querySelector(".thumb");
    const nameEl = node.querySelector(".name");
    const captionEl = node.querySelector(".caption");
    const openBtn = node.querySelector(".openBtn");
    const capBtn = node.querySelector(".capBtn");
    const delBtn = node.querySelector(".delBtn");

    nameEl.textContent = item.name;

    // caption display
    if (item.caption && item.caption.trim().length) {
      captionEl.textContent = item.caption;
      captionEl.classList.remove("empty");
    } else {
      captionEl.textContent = "No caption";
      captionEl.classList.add("empty");
    }

    thumb.style.position = "relative";

    if (item.type === "video") {
      const badge = document.createElement("div");
      badge.className = "video-badge";
      badge.textContent = "Video";

      const vid = document.createElement("video");
      vid.src = item.url;
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = "metadata";

      thumb.appendChild(vid);
      thumb.appendChild(badge);

      thumb.style.cursor = "zoom-in";
      thumb.addEventListener("click", () => lightboxShowVideo(item.url));
      openBtn.addEventListener("click", () => lightboxShowVideo(item.url));
    } else {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name;
      img.loading = "lazy";

      thumb.appendChild(img);

      thumb.style.cursor = "zoom-in";
      thumb.addEventListener("click", () => lightboxShowImage(item.url, item.name));
      openBtn.addEventListener("click", () => lightboxShowImage(item.url, item.name));
    }

    // caption edit
    capBtn.addEventListener("click", async () => {
      const current = item.caption || "";
      const next = prompt("Caption:", current);
      if (next === null) return; // cancelled

      try {
        setStatus("Saving caption…");
        await upsertCaption(item.path, next.trim());
        setStatus("Caption saved.");
        await refreshGallery();
      } catch (e) {
        console.error(e);
        setStatus(`Caption save failed: ${e.message}`, true);
      }
    });

    delBtn.addEventListener("click", () => deleteItem(item.path));

    gallery.appendChild(node);
  }
}

// ----------------------------
// Cache
// ----------------------------
function saveCache(items) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
}
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
