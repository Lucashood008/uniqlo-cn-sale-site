import {
  compareSortKeys,
  DISPLAY_DISCOUNT_MIN,
  filterProducts,
  firstSeenForProduct,
  groupProducts,
  historyForProduct,
  parseChangeSummary,
} from "./utils.mjs";

const PAGE_SIZE = 60;
const FAVORITES_KEY = "uniqlo-sale-favorites-v1";

const state = {
  snapshot: null,
  history: null,
  products: [],
  filtered: [],
  visibleCount: PAGE_SIZE,
  favorites: loadFavorites(),
  favoritesOnly: false,
  changes: { added: null, drops: null, increases: null, missing: null },
};

const elements = {
  activeFilters: document.querySelector("#active-filters"),
  clearFilters: document.querySelector("#clear-filters"),
  dialog: document.querySelector("#product-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
  dialogContent: document.querySelector("#dialog-content"),
  dialogTitle: document.querySelector("#dialog-title"),
  discount: document.querySelector("#discount-filter"),
  empty: document.querySelector("#empty-state"),
  favoriteCount: document.querySelector("#favorite-count"),
  favoritesToggle: document.querySelector("#favorites-toggle"),
  highlightGrid: document.querySelector("#highlight-grid"),
  loadMore: document.querySelector("#load-more"),
  mobileList: document.querySelector("#mobile-product-list"),
  price: document.querySelector("#price-filter"),
  refresh: document.querySelector("#refresh-button"),
  resultCount: document.querySelector("#result-count"),
  search: document.querySelector("#search-input"),
  sort: document.querySelector("#sort-filter"),
  source: document.querySelector("#source-filter"),
  statusNotice: document.querySelector("#status-notice"),
  statusTitle: document.querySelector("#status-title"),
  summaryAdded: document.querySelector("#summary-added"),
  summaryDiscount: document.querySelector("#summary-discount"),
  summaryDrops: document.querySelector("#summary-drops"),
  summaryProducts: document.querySelector("#summary-products"),
  tableBody: document.querySelector("#product-table-body"),
  toast: document.querySelector("#toast"),
  updatedAt: document.querySelector("#updated-at"),
};

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  elements.favoriteCount.textContent = String(state.favorites.size);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number)
    : "—";
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
}

function statusForSnapshot(snapshot) {
  const date = new Date(snapshot.generated_at);
  if (Number.isNaN(date.getTime())) return { title: "已读取最近快照", stale: true };
  const hours = (Date.now() - date.getTime()) / 3_600_000;
  if (hours > 36) return { title: "最近数据可能已经过期", stale: true };
  return { title: "最近一次采集成功", stale: false };
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
  return response.text();
}

async function loadData({ announce = false } = {}) {
  elements.statusNotice.className = "notice hidden";
  elements.statusNotice.textContent = "";
  elements.refresh.disabled = true;
  elements.refresh.textContent = "读取中…";
  const [snapshotResult, historyResult, changesResult] = await Promise.allSettled([
    getJson("./data/latest.json"),
    getJson("./data/price_history.json"),
    getText("./reports/changes.md"),
  ]);

  if (snapshotResult.status !== "fulfilled") {
    elements.statusTitle.textContent = "暂时无法读取商品数据";
    elements.updatedAt.textContent = "请检查网络后重试";
    showNotice("商品快照加载失败，页面没有用空结果覆盖旧数据。", "error");
    elements.refresh.disabled = false;
    elements.refresh.textContent = "重新获取";
    return;
  }

  state.snapshot = snapshotResult.value;
  state.history = historyResult.status === "fulfilled" ? historyResult.value : null;
  state.changes = changesResult.status === "fulfilled"
    ? parseChangeSummary(changesResult.value)
    : state.changes;
  state.products = groupProducts(state.snapshot.products || [])
    .filter((product) => Number(product.discount_percent) >= DISPLAY_DISCOUNT_MIN);

  const status = statusForSnapshot(state.snapshot);
  elements.statusTitle.textContent = status.title;
  elements.updatedAt.textContent = `数据生成于 ${formatTime(state.snapshot.generated_at)}（北京时间）`;
  elements.statusTitle.closest(".status-panel").classList.toggle("is-stale", status.stale);
  if (historyResult.status !== "fulfilled") {
    showNotice("商品列表已加载；价格历史暂时不可用。", "warning");
  } else if (announce) {
    showToast("已获取最新发布数据");
  }

  renderSummary();
  applyFilters();
  elements.refresh.disabled = false;
  elements.refresh.textContent = "获取最新数据";
}

function currentFilters() {
  return {
    query: elements.search.value,
    source: elements.source.value,
    minimumDiscount: elements.discount.value,
    maximumPrice: elements.price.value,
    sort: elements.sort.value,
    favoritesOnly: state.favoritesOnly,
  };
}

function applyFilters({ resetPage = true } = {}) {
  if (resetPage) state.visibleCount = PAGE_SIZE;
  state.filtered = filterProducts(state.products, currentFilters(), state.favorites);
  renderHighlights();
  renderProducts();
  renderActiveFilters();
}

function renderSummary() {
  const maximum = state.products[0]?.discount_percent;
  elements.summaryProducts.textContent = String(state.products.length);
  elements.summaryDiscount.textContent = Number.isFinite(maximum) ? `${maximum}%` : "—";
  elements.summaryAdded.textContent = state.changes.added ?? "—";
  elements.summaryDrops.textContent = state.changes.drops ?? "—";
  elements.favoriteCount.textContent = String(state.favorites.size);
}

function renderHighlights() {
  const items = [...state.filtered]
    .sort(compareSortKeys)
    .slice(0, 9);
  elements.highlightGrid.innerHTML = items.map((product) => {
    const code = escapeHtml(product.item_code);
    const imagePath = `./assets/highlights/${encodeURIComponent(product.product_code)}.jpg`;
    return `
      <article class="highlight-card" data-product-code="${escapeHtml(product.product_code)}">
        <button class="highlight-open" type="button" data-open="${code}">
          <span class="highlight-image-wrap">
            <img src="${imagePath}" alt="" loading="lazy" data-image-fallback>
            <span class="image-fallback" aria-hidden="true">${code.slice(-3)}</span>
            <strong>${escapeHtml(product.discount_percent)}%</strong>
          </span>
          <span class="highlight-name">${escapeHtml(product.name)}</span>
        </button>
        <div class="highlight-meta">
          <button class="copy-code" type="button" data-copy="${code}" aria-label="复制商品编号 ${code}">${code}</button>
          <span>¥${money(product.current_min_price)}</span>
        </div>
      </article>`;
  }).join("");
  elements.highlightGrid.classList.toggle("is-empty", items.length === 0);
  if (!items.length) elements.highlightGrid.innerHTML = "<p>当前筛选条件下没有商品。</p>";
  bindImageFallbacks(elements.highlightGrid);
}

function renderProducts() {
  const visible = state.filtered.slice(0, state.visibleCount);
  elements.resultCount.textContent = `找到 ${state.filtered.length} 款，当前显示 ${visible.length} 款`;
  elements.tableBody.innerHTML = visible.map(tableRow).join("");
  elements.mobileList.innerHTML = visible.map(mobileCard).join("");
  elements.empty.classList.toggle("hidden", state.filtered.length !== 0);
  elements.loadMore.classList.toggle("hidden", visible.length >= state.filtered.length);
}

function tableRow(product) {
  const code = escapeHtml(product.item_code);
  const favorited = state.favorites.has(String(product.item_code));
  return `
    <tr>
      <td><button class="copy-code" type="button" data-copy="${code}" title="复制商品编号">${code}</button></td>
      <td><button class="product-link" type="button" data-open="${code}">${escapeHtml(product.name)}</button></td>
      <td><strong class="discount-value">${escapeHtml(product.discount_percent)}%</strong></td>
      <td class="original-price">¥${money(product.original_price)}</td>
      <td><strong>¥${money(product.current_min_price)}</strong></td>
      <td>${escapeHtml(product.sale_types.join("、"))}</td>
      <td>${escapeHtml(product.genders.join("、"))}</td>
      <td><button class="favorite-button ${favorited ? "is-active" : ""}" type="button" data-favorite="${code}" aria-pressed="${favorited}" aria-label="${favorited ? "取消收藏" : "收藏"}">${favorited ? "♥" : "♡"}</button></td>
    </tr>`;
}

function mobileCard(product) {
  const code = escapeHtml(product.item_code);
  const favorited = state.favorites.has(String(product.item_code));
  return `
    <article class="mobile-card">
      <div class="mobile-card-top">
        <span class="discount-badge">-${escapeHtml(product.discount_percent)}%</span>
        <button class="favorite-button ${favorited ? "is-active" : ""}" type="button" data-favorite="${code}" aria-pressed="${favorited}" aria-label="${favorited ? "取消收藏" : "收藏"}">${favorited ? "♥" : "♡"}</button>
      </div>
      <button class="mobile-card-title" type="button" data-open="${code}">${escapeHtml(product.name)}</button>
      <div class="mobile-price"><strong>¥${money(product.current_min_price)}</strong><del>¥${money(product.original_price)}</del></div>
      <p>${escapeHtml(product.sale_types.join("、"))} · ${escapeHtml(product.genders.join("、"))}</p>
      <button class="copy-code" type="button" data-copy="${code}">商品编号 ${code}</button>
    </article>`;
}

function renderActiveFilters() {
  const filters = currentFilters();
  const labels = [];
  if (filters.query) labels.push(`搜索：${filters.query}`);
  if (filters.source !== "all") labels.push(filters.source);
  if (filters.minimumDiscount !== "40") labels.push(`${filters.minimumDiscount}%及以上`);
  if (filters.maximumPrice !== "all") labels.push(`¥${filters.maximumPrice}以内`);
  if (filters.favoritesOnly) labels.push("仅看收藏");
  elements.activeFilters.innerHTML = labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
}

function clearFilters() {
  elements.search.value = "";
  elements.source.value = "all";
  elements.discount.value = "40";
  elements.price.value = "all";
  elements.sort.value = "discount";
  state.favoritesOnly = false;
  elements.favoritesToggle.setAttribute("aria-pressed", "false");
  elements.favoritesToggle.classList.remove("is-active");
  applyFilters();
}

function toggleFavorite(code) {
  if (state.favorites.has(code)) {
    state.favorites.delete(code);
    showToast(`已取消收藏 ${code}`);
  } else {
    state.favorites.add(code);
    showToast(`已收藏 ${code}`);
  }
  saveFavorites();
  applyFilters({ resetPage: false });
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const input = document.createElement("textarea");
    input.value = code;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast(`已复制商品编号 ${code}`);
}

function showProduct(code) {
  const product = state.products.find((item) => String(item.item_code) === code);
  if (!product) return;
  const history = historyForProduct(product, state.history);
  const firstSeen = firstSeenForProduct(product, state.history);
  const lowest = history.length ? Math.min(...history.map((entry) => entry.price)) : null;
  const favorite = state.favorites.has(code);

  elements.dialogTitle.textContent = product.name;
  elements.dialogContent.innerHTML = `
    <div class="detail-summary">
      <div><span>商品编号</span><button class="copy-code" type="button" data-copy="${escapeHtml(code)}">${escapeHtml(code)}</button></div>
      <div><span>现价</span><strong>¥${money(product.current_min_price)}</strong></div>
      <div><span>原价</span><del>¥${money(product.original_price)}</del></div>
      <div><span>优惠幅度</span><strong>${escapeHtml(product.discount_percent)}%</strong></div>
    </div>
    <button class="detail-favorite ${favorite ? "is-active" : ""}" type="button" data-favorite="${escapeHtml(code)}">${favorite ? "♥ 已收藏" : "♡ 收藏商品"}</button>
    <section class="history-panel">
      <div class="detail-heading"><h3>价格记录</h3><span>${history.length ? `${history.length}天记录` : "暂无记录"}</span></div>
      ${historyChart(history)}
      <p>${lowest === null ? "价格历史暂时不可用。" : `记录期最低价 ¥${money(lowest)}${firstSeen ? ` · 首次观测 ${escapeHtml(firstSeen)}` : ""}`}</p>
    </section>
    <section class="offer-panel">
      <div class="detail-heading"><h3>官网页面</h3><span>${product.offers.length}个入口</span></div>
      <div class="offer-list">
        ${product.offers.map((offer, index) => `<a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">页面 ${index + 1}<span>¥${money(offer.current_min_price)} · ${escapeHtml(offer.product_code)}</span></a>`).join("")}
      </div>
    </section>
    <p class="detail-footnote">${escapeHtml(product.sale_types.join("、"))} · ${escapeHtml(product.genders.join("、"))}。价格以最近一次成功采集为准。</p>`;
  if (!elements.dialog.open) elements.dialog.showModal();
}

function historyChart(history) {
  if (!history.length) return '<div class="history-empty">没有可绘制的历史数据</div>';
  if (history.length === 1) return `<div class="history-single"><strong>¥${money(history[0].price)}</strong><span>${escapeHtml(history[0].date)}</span></div>`;
  const prices = history.map((entry) => entry.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const points = history.map((entry, index) => {
    const x = 8 + (index / (history.length - 1)) * 284;
    const y = 12 + ((max - entry.price) / range) * 76;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `
    <svg class="history-chart" viewBox="0 0 300 104" role="img" aria-label="商品价格变化折线图">
      <line x1="8" y1="88" x2="292" y2="88"></line>
      <polyline points="${points}"></polyline>
      <text x="8" y="102">${escapeHtml(history[0].date)}</text>
      <text x="292" y="102" text-anchor="end">${escapeHtml(history.at(-1).date)}</text>
    </svg>`;
}

function bindImageFallbacks(container) {
  container.querySelectorAll("[data-image-fallback]").forEach((image) => {
    const fallback = () => image.closest(".highlight-image-wrap")?.classList.add("image-missing");
    image.addEventListener("error", fallback, { once: true });
    if (image.complete && image.naturalWidth === 0) fallback();
  });
}

function showNotice(message, kind = "warning") {
  elements.statusNotice.textContent = message;
  elements.statusNotice.className = `notice ${kind}`;
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 1800);
}

function handleAction(event) {
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    copyCode(copy.dataset.copy);
    return;
  }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    toggleFavorite(favorite.dataset.favorite);
    if (elements.dialog.open) showProduct(favorite.dataset.favorite);
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) showProduct(open.dataset.open);
  if (event.target.closest("[data-clear-filters]")) clearFilters();
}

document.addEventListener("click", handleAction);
elements.search.addEventListener("input", () => applyFilters());
[elements.source, elements.discount, elements.price, elements.sort]
  .forEach((element) => element.addEventListener("change", () => applyFilters()));
elements.clearFilters.addEventListener("click", clearFilters);
elements.refresh.addEventListener("click", () => loadData({ announce: true }));
elements.loadMore.addEventListener("click", () => {
  state.visibleCount += PAGE_SIZE;
  renderProducts();
});
elements.favoritesToggle.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  elements.favoritesToggle.setAttribute("aria-pressed", String(state.favoritesOnly));
  elements.favoritesToggle.classList.toggle("is-active", state.favoritesOnly);
  applyFilters();
});
elements.dialogClose.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

window.addEventListener("online", () => showToast("网络已恢复"));
window.addEventListener("offline", () => showNotice("当前处于离线状态，页面可能显示缓存数据。", "warning"));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

loadData();
