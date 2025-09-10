// ===== CONFIG =====
const DEFAULT_CENTER = [10.776, 106.7];
const MIN_ZOOM_FOR_STOPS = 16;

const HCMC_BBOX = { south: 10.3, west: 106.35, north: 11.2, east: 107.05 };

const GRID_STEP = 0.3;
const GRID_CONCURRENCY = 1;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// ===== STATE =====
const state = {
  map: null,
  markers: [],
  drawnIds: new Set(),
  stationsInView: [],
  masterStations: [],
  masterReady: false,
  routes: [],
  lastViewKey: null,
  tempMarker: null,
  myMarker: null,
};

// ===== BOOT =====
window.addEventListener("DOMContentLoaded", async () => {
  state.map = L.map("map").setView(DEFAULT_CENTER, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 150);

  bindUI();
  loadRoutes();

  prefetchAllStopsInHCM().catch(console.error);
  await tryCenterToUser();

  const debounced = debounce(onViewChanged, 600);
  state.map.on("moveend", debounced);
  onViewChanged();
});

// ===== UI =====
function bindUI() {
  const panels = {
    stations: qs("#panel-stations"),
    routes: qs("#panel-routes"),
  };
  qsa(".mode-btn").forEach((btn) => {
    const m = btn.dataset.mode;
    if (!m) return;
    btn.addEventListener("click", () => {
      Object.entries(panels).forEach(([k, v]) =>
        v.classList.toggle("hidden", k !== m)
      );
      qsa(".mode-btn[data-mode]").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === m)
      );
    });
  });

  on("#locateMe", "click", locateMe);
  on("#searchBtn", "click", () => globalSearch(qs("#globalSearch").value));
  on("#globalSearch", "keydown", (e) => {
    if (e.key === "Enter") globalSearch(e.target.value);
  });

  on("#stationFilter", "input", (e) =>
    renderStationList(filterByName(state.stationsInView, e.target.value))
  );
  on("#routeFilter", "input", (e) =>
    renderRouteList(filterByRoute(state.routes, e.target.value))
  );
}

// ===== GLOBAL SEARCH =====
async function globalSearch(raw) {
  const q = (raw || "").trim().toLowerCase();
  if (!q) return;
  if (!state.masterReady)
    toast("Chỉ mục toàn TP.HCM đang nạp… sẽ đầy đủ sau ít giây.");

  const hits = (state.masterStations || []).filter((s) =>
    (s.name || "").toLowerCase().includes(q)
  );
  if (hits.length) {
    const s = hits[0];
    flyToStation(s, true);
    renderStationList(hits.slice(0, 200));
    qs("#stationFilter").value = raw;
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=${encodeURIComponent(
      raw
    )}`;
    const res = await fetch(url, { headers: { "Accept-Language": "vi" } });
    const data = await res.json();
    if (!data.length)
      return toast("Không tìm thấy trạm hoặc địa điểm phù hợp.");
    const { lat, lon } = data[0];
    if (!pointInHCM(+lat, +lon))
      toast("Điểm tìm được ngoài TP.HCM — đang đưa bạn đến vị trí đó.");
    state.map.setView(
      [+lat, +lon],
      Math.max(state.map.getZoom(), MIN_ZOOM_FOR_STOPS)
    );
    onViewChanged();
  } catch (e) {
    console.warn("Geocode error:", e);
    toast("Không thể geocode địa danh lúc này.");
  }
}

// ===== VIEW CHANGE =====
async function onViewChanged() {
  if (state.map.getZoom() < MIN_ZOOM_FOR_STOPS) {
    clearMarkersAndList(
      "Zoom ≥ " +
        MIN_ZOOM_FOR_STOPS +
        " để hiển thị marker trạm trong khung nhìn."
    );
    return;
  }
  const b = state.map.getBounds();
  if (!bboxIntersects(b, HCMC_BBOX)) {
    clearMarkersAndList(
      "Ngoài phạm vi TP.HCM. Kéo bản đồ vào TP.HCM để hiển thị trạm."
    );
    return;
  }
  const key = bboxKey(b);
  if (key === state.lastViewKey) return;
  state.lastViewKey = key;

  await loadStopsInBBox(b);
}

function clearMarkersAndList(message) {
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers = [];
  state.drawnIds.clear();
  state.stationsInView = [];
  renderStationList([]);
  qs("#stationList").innerHTML = `<div class="item small">${message}</div>`;
}

// ===== GEOLOCATION (no alerts) =====
async function tryCenterToUser() {
  if (!navigator.geolocation) return false;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (pointInHCM(lat, lng)) {
          state.map.setView([lat, lng], Math.max(14, MIN_ZOOM_FOR_STOPS));
          if (state.myMarker) state.map.removeLayer(state.myMarker);
          state.myMarker = L.marker([lat, lng], {
            title: "Vị trí của tôi",
            icon: L.icon({
              iconUrl:
                "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
              shadowUrl:
                "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41],
            }),
          })
            .addTo(state.map)
            .bindPopup("📍 Đây là vị trí của tôi")
            .openPopup();
        }
        resolve(true);
      },
      (_) => resolve(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

function locateMe() {
  if (!navigator.geolocation) {
    toast("Trình duyệt không hỗ trợ định vị.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      if (!pointInHCM(lat, lng)) toast("Vị trí hiện tại ngoài TP.HCM.");
      state.map.setView([lat, lng], Math.max(14, MIN_ZOOM_FOR_STOPS));
      onViewChanged();
      if (state.myMarker) state.map.removeLayer(state.myMarker);
      state.myMarker = L.marker([lat, lng], {
        title: "Vị trí của tôi",
        icon: L.icon({
          iconUrl:
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
          shadowUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        }),
      })
        .addTo(state.map)
        .bindPopup("📍 Đây là vị trí của tôi")
        .openPopup();
      toast("📍 Đã cập nhật vị trí thành công");
    },
    (err) => {
      console.warn("Geolocation error:", err);
      // Không hiện alert — chỉ nhắc nhẹ
      toast("Không thể lấy vị trí hiện tại, thử lại sau.");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

// ===== CACHE =====
const OSM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const osmMemCache = new Map();
function cacheKeyFromQuery(q) {
  return "osm_cache_" + q.replace(/\s+/g, " ").trim();
}
function getCache(q) {
  const k = cacheKeyFromQuery(q),
    now = Date.now();
  const mem = osmMemCache.get(k);
  if (mem && now - mem.t <= OSM_CACHE_TTL_MS) return mem.v;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (now - obj.t <= OSM_CACHE_TTL_MS) {
      osmMemCache.set(k, obj);
      return obj.v;
    }
    localStorage.removeItem(k);
  } catch {}
  return null;
}
function setCache(q, v) {
  const k = cacheKeyFromQuery(q),
    obj = { t: Date.now(), v };
  osmMemCache.set(k, obj);
  try {
    localStorage.setItem(k, JSON.stringify(obj));
  } catch {}
}

// ===== OVERPASS (round-robin + retry/backoff) =====
let overpassIdx = 0;
function nextOverpassEndpoint() {
  const url = OVERPASS_ENDPOINTS[overpassIdx % OVERPASS_ENDPOINTS.length];
  overpassIdx++;
  return url;
}
function respectRetryAfterMs(res) {
  const ra = res.headers.get("Retry-After");
  if (!ra) return 0;
  const n = Number(ra);
  return Number.isNaN(n) ? 0 : n * 1000;
}
function jitter(ms) {
  return ms + Math.random() * Math.min(400, ms * 0.25);
}

async function overpass(query, { retries = 4, signal } = {}) {
  const cached = getCache(query);
  if (cached) return cached;

  let attempt = 0,
    lastErr = null;
  while (attempt <= retries) {
    const endpoint = nextOverpassEndpoint();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: "data=" + encodeURIComponent(query),
        signal,
      });
      if (res.status === 429 || res.status === 504 || res.status === 502) {
        const waitRa = respectRetryAfterMs(res);
        const backoff = jitter(Math.min(8000, 500 * 2 ** attempt));
        await sleep(Math.max(waitRa, backoff));
        attempt++;
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setCache(query, data);
      return data;
    } catch (e) {
      lastErr = e;
      if (e.name === "AbortError") throw e;
      const backoff = jitter(Math.min(8000, 500 * 2 ** attempt));
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr || new Error("Overpass failed");
}

// ===== BBOX LOADING (with guard) =====
let bboxLoading = false;
let bboxAborter = null;
async function loadStopsInBBox(bounds) {
  if (bboxLoading) return;
  bboxLoading = true;
  if (bboxAborter) bboxAborter.abort();
  bboxAborter = new AbortController();

  const { south, west, north, east } = toFixedBBox(bounds);
  const query = `
    [out:json][timeout:25];
    (
      node["highway"="bus_stop"](${south},${west},${north},${east});
      node["public_transport"="platform"](${south},${west},${north},${east});
    );
    out body;`;

  try {
    showLoading(true);
    const data = await overpass(query, { signal: bboxAborter.signal });
    const stops = (data.elements || [])
      .filter((el) => el.type === "node")
      .map((el) => ({
        id: el.id,
        name: el.tags?.name || el.tags?.["name:vi"] || "Trạm không tên",
        lat: el.lat,
        lng: el.lon,
      }));
    state.stationsInView = dedupById(stops);
    renderStationsOnMap(state.stationsInView);
    renderStationList(state.stationsInView);
  } catch (e) {
    console.warn("BBOX load error:", String(e));
    toast(
      "Không tải được trạm (có thể bị giới hạn tạm thời). Thử lại sau ít giây."
    );
  } finally {
    showLoading(false);
    bboxLoading = false;
  }
}

// ===== PREFETCH MASTER =====
async function prefetchAllStopsInHCM() {
  const tiles = buildTiles(HCMC_BBOX, GRID_STEP);
  let done = 0;
  const idSet = new Set();
  const all = [];
  while (done < tiles.length) {
    const batch = tiles.slice(done, done + GRID_CONCURRENCY);
    await Promise.all(
      batch.map(async (t) => {
        const query = `
        [out:json][timeout:25];
        (
          node["highway"="bus_stop"](${t.s},${t.w},${t.n},${t.e});
          node["public_transport"="platform"](${t.s},${t.w},${t.n},${t.e});
        );
        out body;`;
        try {
          const data = await overpass(query);
          for (const el of data.elements || []) {
            if (el.type !== "node") continue;
            if (idSet.has(el.id)) continue;
            idSet.add(el.id);
            all.push({
              id: el.id,
              name: el.tags?.name || el.tags?.["name:vi"] || "Trạm không tên",
              lat: el.lat,
              lng: el.lon,
            });
          }
        } catch (e) {
          console.warn(
            "Tile lỗi (sẽ bỏ qua):",
            `${t.s},${t.w},${t.n},${t.e}`,
            String(e)
          );
        }
      })
    );
    done += batch.length;
    updateMasterProgress(done, tiles.length, all.length);
    await sleep(300);
  }
  state.masterStations = all;
  state.masterReady = true;
  qs("#masterCount").textContent = `${all.length.toLocaleString("vi-VN")} trạm`;
  qs("#masterProgress").textContent = `xong (${all.length.toLocaleString(
    "vi-VN"
  )} trạm)`;
}

// ===== RENDER =====
function renderStationsOnMap(stations) {
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers = [];
  state.drawnIds.clear();
  stations.forEach((s) => {
    if (state.drawnIds.has(s.id)) return;
    const m = L.marker([s.lat, s.lng])
      .addTo(state.map)
      .bindPopup(
        `<b>${escapeHTML(s.name)}</b><br/><span class="small">OSM id: ${
          s.id
        }</span>`
      );
    state.markers.push(m);
    state.drawnIds.add(s.id);
  });
}
function renderStationList(stations) {
  const list = qs("#stationList");
  list.innerHTML = "";
  if (!stations.length) {
    list.innerHTML = `<div class="item small">Không có trạm để hiển thị.</div>`;
    return;
  }
  stations.forEach((s) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<b>${escapeHTML(
      s.name
    )}</b><br/><span class="small">${s.lat.toFixed(5)}, ${s.lng.toFixed(
      5
    )}</span>`;
    el.addEventListener("click", () => flyToStation(s, true));
    list.appendChild(el);
  });
}
function flyToStation(s, highlight = false) {
  state.map.setView([s.lat, s.lng], Math.max(17, MIN_ZOOM_FOR_STOPS));
  let marker = state.markers.find((m) => {
    const ll = m.getLatLng();
    return Math.abs(ll.lat - s.lat) < 1e-6 && Math.abs(ll.lng - s.lng) < 1e-6;
  });
  if (!marker && highlight) {
    if (state.tempMarker) state.map.removeLayer(state.tempMarker);
    state.tempMarker = L.marker([s.lat, s.lng], { title: s.name })
      .addTo(state.map)
      .bindPopup(
        `<b>${escapeHTML(
          s.name
        )}</b><br/><span class="small">Từ kết quả tìm kiếm</span>`
      )
      .openPopup();
  } else {
    marker && marker.openPopup();
  }
}

// ===== ROUTES (demo) =====
const ROUTES_SEED = [
  ["01", "Bến Thành - BX Chợ Lớn"],
  ["02", "Bến Thành - BX Miền Tây"],
  ["03", "Bến Thành - Thạnh Lộc"],
  ["04", "Bến Thành - Cộng Hòa - An Sương"],
  ["05", "BX Chợ Lớn - Biên Hòa"],
  ["06", "BX Chợ Lớn - ĐH Nông Lâm"],
  ["07", "BX Chợ Lớn - Gò Vấp"],
  ["08", "BX Quận 8 - ĐH Quốc Gia"],
  ["09", "Chợ Lớn - Bình Chánh - Hưng Long"],
  ["10", "ĐH Quốc Gia - BX Miền Tây"],
  ["11", "Bến Thành - Đầm Sen"],
  ["12", "Bến Thành - Thác Giang Điền"],
  ["13", "Bến Thành - BX Củ Chi"],
  ["14", "Miền Đông - 3/2 - Miền Tây"],
  ["15", "Bến Phú Định - Đầm Sen"],
  ["16", "BX Chợ Lớn - BX Tân Phú"],
  ["17", "BX Chợ Lớn - ĐH Sài Gòn - KCX Tân Thuận"],
  ["18", "Bến Thành - Chợ Hiệp Thành"],
  ["19", "Bến Thành - KCX Linh Trung - ĐHQG"],
  ["20", "Bến Thành - Nhà Bè"],
  ["22", "BX Quận 8 - KCN Lê Minh Xuân"],
  ["23", "BX Chợ Lớn - Ngã 3 Giồng - Cầu Lớn"],
  ["24", "BX Miền Đông - Hóc Môn"],
  ["25", "BX Quận 8 - KDC Vĩnh Lộc A"],
  ["27", "Bến Thành - Âu Cơ - An Sương"],
  ["28", "Bến Thành - Chợ Xuân Thới Thượng"],
  ["29", "Bến phà Cát Lái - Chợ Nông Sản Thủ Đức"],
  ["30", "Chợ Tân Hương - ĐH Quốc tế"],
  ["31", "KDC Tân Quy - Bến Thành - KDC Bình Lợi"],
  ["32", "BX Miền Tây - BX Ngã Tư Ga"],
  ["33", "BX An Sương - Suối Tiên - ĐHQG"],
  ["34", "Bến Thành - ĐH Công Nghệ Sài Gòn"],
  ["35", "Quận 1 - Quận 2"],
  ["36", "Bến Thành - Thới An"],
  ["37", "Cảng Q4 - Nhơn Đức"],
  ["38", "KDC Tân Quy - Đầm Sen"],
  ["39", "Bến Thành - Võ Văn Kiệt - BX Miền Tây"],
  ["40", "BX Miền Đông - BX Ngã Tư Ga"],
  ["41", "BX Miền Tây - Bốn Xã - BX An Sương"],
  ["42", "Chợ Cầu Muối - Chợ nông sản Thủ Đức"],
  ["43", "BX Miền Đông - Phà Cát Lái"],
  ["44", "Cảng Q4 - Bình Quới"],
  ["45", "BX Quận 8 - Bến Thành - BX Miền Đông"],
  ["46", "Cảng Q4 - Bến Thành - Bến Mễ Cốc"],
  ["47", "BX Chợ Lớn - QL50 - Hưng Long"],
  ["48", "BX Tân Phú - Chợ Hiệp Thành"],
  ["50", "ĐH Bách khoa - ĐHQG"],
  ["51", "BX Miền Đông - Bình Hưng Hòa"],
  ["52", "Bến Thành - ĐH Quốc tế"],
  ["53", "Lê Hồng Phong - ĐHQG"],
  ["54", "BX Miền Đông - BX Chợ Lớn"],
  ["55", "CVPM Quang Trung - Khu CNC Q9"],
  ["56", "BX Chợ Lớn - ĐH GTVT"],
  ["57", "Chợ Phước Bình - THPT Hiệp Bình"],
  ["58", "BX Ngã 4 Ga - KCN Đông Nam"],
  ["59", "BX Quận 8 - BX Ngã 4 Ga"],
  ["60", "BX An Sương - KCN Lê Minh Xuân"],
  ["60-1", "BX Miền Tây - BX Biên Hòa"],
  ["60-3", "BX Miền Đông - KCN Nhơn Trạch"],
  ["60-4", "BX Miền Đông - BX Hố Nai"],
  ["61", "BX Chợ Lớn - KCN Lê Minh Xuân"],
  ["61-1", "Thủ Đức - Dĩ An"],
  ["61-3", "BX An Sương - Thủ Dầu Một"],
  ["61-4", "Bến Dược - Dầu Tiếng"],
  ["61-6", "Bến Thành - KDL Đại Nam"],
  ["61-7", "Bến đò Bình Mỹ - BX Bình Dương"],
  ["61-8", "BX Miền Tây - KDL Đại Nam"],
  ["62", "BX Quận 8 - Thới An"],
  ["62-1", "Chợ Lớn - Bến Lức"],
  ["62-2", "BX Chợ Lớn - Ngã 3 Tân Lân"],
  ["62-3", "Bến Củ Chi - BX Hậu Nghĩa"],
  ["62-4", "TT Tân Túc - Chợ Bến Lức"],
  ["62-5", "BX An Sương - BX Hậu Nghĩa"],
  ["62-7", "BX Chợ Lớn - BX Đức Huệ"],
  ["62-8", "BX Chợ Lớn - BX Tân An"],
  ["62-9", "BX Quận 8 - Cầu Nổi"],
  ["62-10", "BX Chợ Lớn - Thanh Vĩnh Đông"],
  ["62-11", "BX Miền Tây - Tân Tập"],
  ["64", "BX Miền Đông - Đầm Sen"],
  ["65", "Bến Thành - CMT8 - BX An Sương"],
  ["66", "BX Chợ Lớn - BX An Sương"],
  ["68", "BX Chợ Lớn - KCX Tân Thuận"],
  ["69", "CV 23/9 - KCN Tân Bình"],
  ["70", "Tân Quy - Bến Súc"],
  ["70-1", "BX Củ Chi - BX Gò Dầu"],
  ["70-2", "BX Củ Chi - Hòa Thành"],
  ["70-3", "Bến Thành - Mộc Bài"],
  ["71", "BX An Sương - Phật Cô Đơn"],
  ["72", "CV 23/9 - Hiệp Phước"],
  ["73", "Chợ Bình Chánh - KCN Lê Minh Xuân"],
  ["74", "BX An Sương - BX Củ Chi"],
  ["75", "Sài Gòn - Cần Giờ"],
  ["76", "Long Phước - Suối Tiên - Đền Vua Hùng"],
  ["77", "Đồng Hòa - Cần Thạnh"],
  ["78", "Thới An - Hóc Môn"],
  ["79", "BX Củ Chi - Đền Bến Dược"],
  ["81", "BX Chợ Lớn - Lê Minh Xuân"],
  ["83", "BX Củ Chi - Cầu Thầy Cai"],
  ["84", "BX Chợ Lớn - Tân Túc"],
  ["85", "BX An Sương - Hậu Nghĩa"],
  ["86", "Bến Thành - ĐH Tôn Đức Thắng"],
  ["87", "BX Củ Chi - An Nhơn Tây"],
  ["88", "Bến Thành - Chợ Long Phước"],
  ["89", "ĐH Nông Lâm - THPT Hiệp Bình"],
  ["90", "Phà Bình Khánh - Cần Thạnh"],
  ["91", "BX Miền Tây - Chợ nông sản Thủ Đức"],
  ["93", "Bến Thành - ĐH Nông Lâm"],
  ["94", "BX Chợ Lớn - BX Củ Chi"],
  ["95", "BX Miền Đông - KCN Tân Bình"],
  ["96", "Bến Thành - Chợ Bình Điền"],
  ["99", "Chợ Thạnh Mỹ Lợi - ĐHQG"],
  ["100", "BX Củ Chi - Cầu Tân Thái"],
  ["101", "BX Chợ Lớn - Chợ Tân Nhựt"],
  ["102", "Bến Thành - Nguyễn Văn Linh - BX Miền Tây"],
  ["103", "BX Chợ Lớn - BX Ngã 4 Ga"],
  ["104", "BX An Sương - ĐH Nông Lâm"],
  ["107", "BX Củ Chi - Bố Heo"],
  ["109", "CV 23/9 - Sân bay Tân Sơn Nhất"],
  ["110", "Phú Xuân - Hiệp Phước"],
  ["119", "Sân bay TSN - BX Miền Tây"],
  ["120", "Tuyến vòng khu vực trung tâm"],
  ["122", "BX An Sương - Tân Quy"],
  ["123", "Phú Mỹ Hưng (khu H) - Quận 1"],
  ["124", "Phú Mỹ Hưng (khu S) - Quận 1"],
  ["126", "BX Củ Chi - Bình Mỹ"],
  ["127", "An Thới Đông - Ngã ba Bà Xán"],
  ["128", "Tân Điền - An Nghĩa"],
  ["139", "BX Miền Tây - Phú Xuân"],
  ["140", "CV 23/9 - Phạm Thế Hiển - Ba Tơ"],
  ["141", "KDL BCR - Long Trường - KCX Linh Trung 2"],
  ["144", "BX Miền Tây - Chợ Lớn - CV Đầm Sen - CX Nhiêu Lộc"],
  ["145", "BX Chợ Lớn - Chợ Hiệp Thành"],
  ["146", "BX Miền Đông - Chợ Hiệp Thành"],
  ["148", "BX Miền Tây - Gò Vấp"],
  ["149", "CV 23/9 - KDC Bình Hưng Hòa"],
  ["150", "BX Chợ Lớn - Ngã 3 Tân Vạn"],
  ["151", "BX Miền Tây - BX An Sương"],
  ["152", "KDC Trung Sơn - Bến Thành - Sân bay TSN"],
  ["C010", "Phổ Quang - KCN Hiệp Phước"],
];
function loadRoutes() {
  state.routes = ROUTES_SEED.map(([id, name]) => ({ id, name }));
  renderRouteList(state.routes);
}
function filterByRoute(arr, q) {
  q = (q || "").toLowerCase();
  if (!q) return arr;
  return arr.filter(
    (r) =>
      r.id.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)
  );
}
function renderRouteList(routes) {
  const list = qs("#routeList");
  qs("#routeCount").textContent = routes.length;
  list.innerHTML = "";
  routes.forEach((r) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<span class="badge">${r.id}</span> &nbsp; ${escapeHTML(
      r.name
    )}`;
    list.appendChild(el);
  });
}

// ===== HELPERS =====
function qs(s) {
  return document.querySelector(s);
}
function qsa(s) {
  return Array.from(document.querySelectorAll(s));
}
function on(sel, ev, fn) {
  qs(sel).addEventListener(ev, fn);
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, a), ms);
  };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function escapeHTML(s) {
  return String(s).replace(
    /[&<>"'`=\/]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "/": "&#x2F;",
        "`": "&#x60;",
        "=": "&#x3D;",
      }[c])
  );
}
function dedupById(arr) {
  const seen = new Set(),
    out = [];
  for (const a of arr) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}
function showLoading(on) {
  qs("#loading").style.display = on ? "block" : "none";
}
function bboxKey(b) {
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
    .map((x) => x.toFixed(4))
    .join(",");
}
function toFixedBBox(bounds) {
  return {
    south: bounds.getSouth().toFixed(6),
    west: bounds.getWest().toFixed(6),
    north: bounds.getNorth().toFixed(6),
    east: bounds.getEast().toFixed(6),
  };
}
function bboxIntersects(b, box) {
  const s = b.getSouth(),
    w = b.getWest(),
    n = b.getNorth(),
    e = b.getEast();
  const is = Math.max(s, box.south),
    iw = Math.max(w, box.west),
    inr = Math.min(n, box.north),
    ie = Math.min(e, box.east);
  return is < inr && iw < ie;
}
function pointInHCM(lat, lng) {
  return (
    lat >= HCMC_BBOX.south &&
    lat <= HCMC_BBOX.north &&
    lng >= HCMC_BBOX.west &&
    lng <= HCMC_BBOX.east
  );
}
function buildTiles(box, step) {
  const tiles = [];
  for (let s = box.south; s < box.north; s += step) {
    for (let w = box.west; w < box.east; w += step) {
      const n = Math.min(s + step, box.north),
        e = Math.min(w + step, box.east);
      tiles.push({
        s: +s.toFixed(5),
        w: +w.toFixed(5),
        n: +n.toFixed(5),
        e: +e.toFixed(5),
      });
    }
  }
  return tiles;
}
function updateMasterProgress(done, total, count) {
  const pct = Math.round((done / total) * 100);
  qs("#masterProgress").textContent = `${pct}%`;
  qs("#masterCount").textContent = `${count.toLocaleString("vi-VN")} trạm`;
}

// Simple toast
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2500);
}
