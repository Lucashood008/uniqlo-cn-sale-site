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
  pendingProduct: new URLSearchParams(location.search).get("product"),
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
  filterPanel: document.querySelector("#filters"),
  filterToggle: document.querySelector("#filter-toggle"),
  favoritesToggle: document.querySelector("#favorites-toggle"),
  highlightGrid: document.querySelector("#highlight-grid"),
  loadMore: document.querySelector("#load-more"),
  mobileList: document.querySelector("#mobile-product-list"),
  price: document.querySelector("#price-filter"),
  refresh: document.querySelector("#refresh-button"),
  resultCount: document.querySelector("#result-count"),
  search: document.querySelector("#search-input"),
  shareResults: document.querySelector("#share-results"),
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

function priceLabel(product) {
  const minimum = Number(product.current_min_price);
  const maximum = Number(product.current_max_price);
  if (!Number.isFinite(minimum)) return "价格未知";
  if (Number.isFinite(maximum) && maximum > minimum) {
    return `¥${money(minimum)}–¥${money(maximum)}`;
  }
  return `¥${money(minimum)}`;
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
  let snapshot;
  try {
    snapshot = await getJson("./data/latest.json");
  } catch {
    elements.statusTitle.textContent = "暂时无法读取商品数据";
    elements.updatedAt.textContent = "请检查网络后重试";
    showNotice("商品快照加载失败，页面没有用空结果覆盖旧数据。", "error");
    elements.refresh.disabled = false;
    elements.refresh.textContent = "重新读取";
    return;
  }

  state.snapshot = snapshot;
  state.products = groupProducts(state.snapshot.products || [])
    .filter((product) => Number(product.discount_percent) >= DISPLAY_DISCOUNT_MIN);

  const status = statusForSnapshot(state.snapshot);
  elements.statusTitle.textContent = status.title;
  elements.updatedAt.textContent = `数据生成于 ${formatTime(state.snapshot.generated_at)}（北京时间）`;
  elements.statusTitle.closest(".status-panel").classList.toggle("is-stale", status.stale);
  renderSummary();
  applyFilters();
  elements.refresh.disabled = false;
  elements.refresh.textContent = "刷新已发布数据";
  if (state.pendingProduct) {
    showProduct(state.pendingProduct, { updateUrl: false });
    state.pendingProduct = null;
  }
  if (announce) showToast("已重新读取最新发布数据");

  const [historyResult, changesResult] = await Promise.allSettled([
    getJson("./data/price_history.json"),
    getText("./reports/changes.md"),
  ]);
  state.history = historyResult.status === "fulfilled" ? historyResult.value : null;
  state.changes = changesResult.status === "fulfilled"
    ? parseChangeSummary(changesResult.value)
    : state.changes;
  renderSummary();
  const openProduct = elements.dialog.open
    ? new URLSearchParams(location.search).get("product")
    : "";
  if (openProduct) showProduct(openProduct, { updateUrl: false });
  if (historyResult.status !== "fulfilled") {
    showNotice("商品清单已加载；价格历史暂时不可用。", "warning");
  }
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

function readUrlState() {
  const params = new URLSearchParams(location.search);
  const values = {
    query: params.get("q") || "",
    source: params.get("source") || "all",
    discount: params.get("discount") || "40",
    price: params.get("max") || "all",
    sort: params.get("sort") || "discount",
  };
  elements.search.value = values.query;
  if ([...elements.source.options].some((option) => option.value === values.source)) elements.source.value = values.source;
  if ([...elements.discount.options].some((option) => option.value === values.discount)) elements.discount.value = values.discount;
  if ([...elements.price.options].some((option) => option.value === values.price)) elements.price.value = values.price;
  if ([...elements.sort.options].some((option) => option.value === values.sort)) elements.sort.value = values.sort;
}

function writeUrlState() {
  const params = new URLSearchParams(location.search);
  const filters = currentFilters();
  const setOrDelete = (key, value, defaultValue) => {
    if (!value || value === defaultValue) params.delete(key);
    else params.set(key, value);
  };
  setOrDelete("q", filters.query.trim(), "");
  setOrDelete("source", filters.source, "all");
  setOrDelete("discount", filters.minimumDiscount, "40");
  setOrDelete("max", filters.maximumPrice, "all");
  setOrDelete("sort", filters.sort, "discount");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

function updateProductParam(code = "") {
  const params = new URLSearchParams(location.search);
  if (code) params.set("product", code);
  else params.delete("product");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

function applyFilters({ resetPage = true } = {}) {
  if (resetPage) state.visibleCount = PAGE_SIZE;
  state.filtered = filterProducts(state.products, currentFilters(), state.favorites);
  renderHighlights();
  renderProducts();
  renderActiveFilters();
  writeUrlState();
}

function renderSummary() {
  const maximum = state.products.reduce((value, product) => Math.max(value, Number(product.discount_percent) || 0), 0);
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
            <img src="${imagePath}" alt="${escapeHtml(product.name)}" loading="lazy" data-image-fallback>
            <span class="image-fallback">暂无商品图<br>编号 ${code}</span>
            <strong>${escapeHtml(product.discount_percent)}%</strong>
          </span>
          <span class="highlight-name">${escapeHtml(product.name)}</span>
        </button>
        <div class="highlight-meta">
          <button class="copy-code" type="button" data-copy="${code}" aria-label="复制商品编号 ${code}">${code}</button>
          <span>${priceLabel(product)}</span>
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
      <td><strong>${priceLabel(product)}</strong></td>
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
      <div class="mobile-price"><strong>${priceLabel(product)}</strong><del>¥${money(product.original_price)}</del></div>
      <p>${escapeHtml(product.sale_types.join("、"))} · ${escapeHtml(product.genders.join("、"))}</p>
      <button class="copy-code" type="button" data-copy="${code}">商品编号 ${code}</button>
    </article>`;
}

function renderActiveFilters() {
  const filters = currentFilters();
  const labels = [];
  if (filters.query) labels.push(["query", `搜索：${filters.query}`]);
  if (filters.source !== "all") labels.push(["source", filters.source]);
  if (filters.minimumDiscount !== "40") labels.push(["discount", `${filters.minimumDiscount}%及以上`]);
  if (filters.maximumPrice !== "all") labels.push(["price", `¥${filters.maximumPrice}以内`]);
  if (filters.favoritesOnly) labels.push(["favorites", "仅看收藏"]);
  if (!labels.length) {
    elements.activeFilters.innerHTML = '<span class="filter-scope">当前显示全部符合门槛的商品</span>';
    return;
  }
  elements.activeFilters.innerHTML = labels.map(([key, label]) => (
    `<button class="active-filter" type="button" data-remove-filter="${key}" aria-label="移除条件 ${escapeHtml(label)}">${escapeHtml(label)} ×</button>`
  )).join("");
}

function clearFilters() {
  elements.search.value = "";
  elements.source.value = "all";
  elements.discount.value = "40";
  elements.price.value = "all";
  elements.sort.value = "discount";
  applyFilters();
}

function removeFilter(key) {
  if (key === "query") elements.search.value = "";
  if (key === "source") elements.source.value = "all";
  if (key === "discount") elements.discount.value = "40";
  if (key === "price") elements.price.value = "all";
  if (key === "favorites") {
    state.favoritesOnly = false;
    elements.favoritesToggle.setAttribute("aria-pressed", "false");
    elements.favoritesToggle.classList.remove("is-active");
  }
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

async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const input = document.createElement("textarea");
    input.value = url;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast("分享链接已复制");
}

function shareCurrentResults() {
  writeUrlState();
  shareLink({
    title: "优衣库男装优惠筛选结果",
    text: `当前筛选找到 ${state.filtered.length} 款，价格以页面标注的采集时间为准。`,
    url: location.href,
  });
}

function shareProduct(code) {
  const product = state.products.find((item) => String(item.item_code) === code);
  if (!product) return;
  const url = new URL(location.href);
  url.searchParams.set("product", code);
  shareLink({
    title: product.name,
    text: `${product.name}，${priceLabel(product)}，优惠 ${product.discount_percent}%。价格以页面标注的采集时间为准。`,
    url: url.href,
  });
}

function showProduct(code, { updateUrl = true } = {}) {
  const product = state.products.find((item) => String(item.item_code) === code);
  if (!product) return;
  const history = historyForProduct(product, state.history);
  const firstSeen = firstSeenForProduct(product, state.history);
  const lowest = history.length ? Math.min(...history.map((entry) => entry.price)) : null;
  const favorite = state.favorites.has(code);
  const imagePath = `./assets/highlights/${encodeURIComponent(product.product_code)}.jpg`;
  const primaryOffer = product.offers[0];

  elements.dialogTitle.textContent = product.name;
  elements.dialogContent.innerHTML = `
    <div class="detail-product">
      <img class="detail-image" src="${imagePath}" alt="${escapeHtml(product.name)}" data-detail-image>
      <div>
        <p class="detail-price-label">当前观测价格${Number(product.current_max_price) > Number(product.current_min_price) ? "区间" : ""}</p>
        <p class="detail-price">${priceLabel(product)}</p>
        <button class="copy-code" type="button" data-copy="${escapeHtml(code)}">商品编号 ${escapeHtml(code)}</button>
        <div class="detail-actions">
          ${primaryOffer ? `<a class="official-button" href="${escapeHtml(primaryOffer.url)}" target="_blank" rel="noopener noreferrer">前往官网查看</a>` : ""}
          <button class="detail-share" type="button" data-share-product="${escapeHtml(code)}">分享商品</button>
        </div>
      </div>
    </div>
    <div class="detail-summary">
      <div><span>页面入口</span><strong>${product.offers.length}</strong></div>
      <div><span>现价</span><strong>${priceLabel(product)}</strong></div>
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
        ${product.offers.map((offer, index) => `<a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">官网入口 ${index + 1}<span>¥${money(offer.current_min_price)}${Number(offer.current_max_price) > Number(offer.current_min_price) ? `–¥${money(offer.current_max_price)}` : ""} · ${escapeHtml(offer.product_code)}</span></a>`).join("")}
      </div>
    </section>
    <p class="detail-footnote">${escapeHtml(product.sale_types.join("、"))} · ${escapeHtml(product.genders.join("、"))}。价格、库存、颜色和尺码以官网为准；本站为非官方项目。</p>`;
  const detailImage = elements.dialogContent.querySelector("[data-detail-image]");
  detailImage?.addEventListener("error", () => { detailImage.hidden = true; }, { once: true });
  if (detailImage?.complete && detailImage.naturalWidth === 0) detailImage.hidden = true;
  if (!elements.dialog.open) elements.dialog.showModal();
  if (updateUrl) updateProductParam(code);
}

function historyChart(history) {
  if (!history.length) return '<div class="history-empty">没有可绘制的历史数据</div>';
  if (history.length === 1) return `<div class="history-single"><strong>¥${money(history[0].price)}</strong><span>${escapeHtml(history[0].date)}</span></div>`;
  const prices = history.map((entry) => entry.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    return `<div class="history-single"><strong>¥${money(min)}</strong><span>最近${history.length}次观测价格未变</span></div>`;
  }
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
      <text x="8" y="10">¥${money(max)}</text>
      <text x="8" y="86">¥${money(min)}</text>
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
  const remove = event.target.closest("[data-remove-filter]");
  if (remove) {
    removeFilter(remove.dataset.removeFilter);
    return;
  }
  const share = event.target.closest("[data-share-product]");
  if (share) {
    shareProduct(share.dataset.shareProduct);
    return;
  }
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
elements.filterPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  applyFilters();
});
elements.filterToggle.addEventListener("click", () => {
  const expanded = elements.filterToggle.getAttribute("aria-expanded") !== "true";
  elements.filterToggle.setAttribute("aria-expanded", String(expanded));
  elements.filterPanel.classList.toggle("is-expanded", expanded);
});
elements.clearFilters.addEventListener("click", clearFilters);
elements.refresh.addEventListener("click", () => loadData({ announce: true }));
elements.shareResults.addEventListener("click", shareCurrentResults);
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
elements.dialogClose.addEventListener("click", () => {
  elements.dialog.close();
  updateProductParam();
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) {
    elements.dialog.close();
    updateProductParam();
  }
});
elements.dialog.addEventListener("close", () => updateProductParam());

window.addEventListener("popstate", () => {
  readUrlState();
  if (state.products.length) applyFilters();
});

window.addEventListener("online", () => showToast("网络已恢复"));
window.addEventListener("offline", () => showNotice("当前处于离线状态，页面可能显示缓存数据。", "warning"));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

readUrlState();
loadData();
