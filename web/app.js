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
const FAVORITE_PRODUCTS_KEY = "uniqlo-sale-favorite-products-v1";
const mobileFilters = window.matchMedia("(max-width: 680px)");

const state = {
  snapshot: null,
  history: null,
  products: [],
  filtered: [],
  visibleCount: PAGE_SIZE,
  favorites: loadFavorites(),
  favoriteProducts: loadFavoriteProducts(),
  favoritesOnly: false,
  appliedFilters: { source: "all", minimumDiscount: "40", maximumPrice: "all", sort: "discount" },
  filterSnapshot: null,
  filterHistoryReturn: null,
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
  favoriteMissing: document.querySelector("#favorite-missing"),
  favoriteMissingList: document.querySelector("#favorite-missing-list"),
  favoriteCount: document.querySelector("#favorite-count"),
  filterApply: document.querySelector("#filter-apply"),
  filterBackdrop: document.querySelector("#filter-backdrop"),
  filterClose: document.querySelector("#filter-close"),
  filterFields: document.querySelector("#filter-fields"),
  filterPanel: document.querySelector("#filters"),
  filterToggle: document.querySelector("#filter-toggle"),
  favoritesToggle: document.querySelector("#favorites-toggle"),
  highlightGrid: document.querySelector("#highlight-grid"),
  loadMore: document.querySelector("#load-more"),
  mobileList: document.querySelector("#mobile-product-list"),
  catalogSummary: document.querySelector("#catalog-summary"),
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

function loadFavoriteProducts() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(FAVORITE_PRODUCTS_KEY) || "{}")));
  } catch {
    return new Map();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  localStorage.setItem(FAVORITE_PRODUCTS_KEY, JSON.stringify(Object.fromEntries(state.favoriteProducts)));
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
  const hadProducts = state.products.length > 0;
  elements.statusNotice.className = "notice hidden";
  elements.statusNotice.textContent = "";
  elements.refresh.disabled = true;
  elements.refresh.textContent = "读取中…";
  let snapshot;
  try {
    snapshot = await getJson("./data/latest.json");
  } catch {
    elements.statusTitle.textContent = hadProducts ? "刷新失败，继续显示原数据" : "暂时无法读取商品数据";
    elements.updatedAt.textContent = hadProducts ? elements.updatedAt.textContent : "请检查网络后重试";
    showNotice(hadProducts ? "未能取得新数据，当前清单仍是刷新前的版本。" : "商品快照加载失败，请检查网络后重试。", "error");
    elements.refresh.disabled = false;
    elements.refresh.textContent = "重新读取";
    return;
  }

  state.snapshot = snapshot;
  state.products = groupProducts(state.snapshot.products || [])
    .filter((product) => Number(product.discount_percent) >= DISPLAY_DISCOUNT_MIN);
  syncFavoriteProducts();

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

function syncFavoriteProducts() {
  state.products.forEach((product) => {
    const code = String(product.item_code);
    if (!state.favorites.has(code)) return;
    state.favoriteProducts.set(code, {
      item_code: code,
      name: product.name,
      current_min_price: product.current_min_price,
      current_max_price: product.current_max_price,
      discount_percent: product.discount_percent,
    });
  });
  saveFavorites();
}

function currentFilters() {
  return {
    query: elements.search.value,
    ...state.appliedFilters,
    favoritesOnly: state.favoritesOnly,
  };
}

function filterControls() {
  return {
    source: elements.source.value,
    minimumDiscount: elements.discount.value,
    maximumPrice: elements.price.value,
    sort: elements.sort.value,
  };
}

function writeFilterControls(filters) {
  elements.source.value = filters.source;
  elements.discount.value = filters.minimumDiscount;
  elements.price.value = filters.maximumPrice;
  elements.sort.value = filters.sort;
}

function commitFilterControls() {
  state.appliedFilters = filterControls();
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
  commitFilterControls();
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
  history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

function updateProductParam(code = "", { push = false } = {}) {
  const params = new URLSearchParams(location.search);
  if (code) params.set("product", code);
  else params.delete("product");
  const url = `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`;
  if (push) history.pushState({ uniqloProduct: code }, "", url);
  else history.replaceState(history.state, "", url);
}

function applyFilters({ resetPage = true } = {}) {
  if (resetPage) state.visibleCount = PAGE_SIZE;
  state.filtered = filterProducts(state.products, currentFilters(), state.favorites);
  renderHighlights();
  renderProducts();
  renderActiveFilters();
  updateFilterToggle();
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
  elements.resultCount.textContent = state.favoritesOnly
    ? `已收藏 ${state.favorites.size} 款，当前符合条件 ${state.filtered.length} 款`
    : `当前找到 ${state.filtered.length} 款，已显示 ${visible.length} 款`;
  elements.filterApply.textContent = `查看 ${state.filtered.length} 款结果`;
  elements.catalogSummary.textContent = state.filtered.length
    ? `已显示 ${visible.length}/${state.filtered.length} 款`
    : "当前条件下没有商品";
  elements.tableBody.innerHTML = visible.map(tableRow).join("");
  elements.mobileList.innerHTML = visible.map(mobileCard).join("");
  elements.empty.classList.toggle("hidden", state.filtered.length !== 0);
  elements.loadMore.classList.toggle("hidden", visible.length >= state.filtered.length);
  if (visible.length < state.filtered.length) {
    elements.loadMore.textContent = `继续加载（已显示 ${visible.length}/${state.filtered.length} 款）`;
  }
  renderUnavailableFavorites();
}

function renderUnavailableFavorites() {
  const currentCodes = new Set(state.products.map((product) => String(product.item_code)));
  const unavailable = [...state.favorites].filter((code) => !currentCodes.has(code));
  const show = state.favoritesOnly && unavailable.length > 0;
  elements.favoriteMissing.classList.toggle("hidden", !show);
  if (!show) {
    elements.favoriteMissingList.innerHTML = "";
    return;
  }
  elements.favoriteMissingList.innerHTML = unavailable.map((code) => {
    const saved = state.favoriteProducts.get(code);
    const name = saved?.name ? `<strong>${escapeHtml(saved.name)}</strong>` : "";
    return `<article><div>${name}<span>商品编号 ${escapeHtml(code)}</span></div><button class="copy-code" type="button" data-copy="${escapeHtml(code)}">复制编号</button><button class="favorite-remove" type="button" data-favorite="${escapeHtml(code)}">移除收藏</button></article>`;
  }).join("");
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
        <span class="discount-badge">优惠 ${escapeHtml(product.discount_percent)}%</span>
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
  if (filters.maximumPrice !== "all") labels.push(["price", `最低观测价≤¥${filters.maximumPrice}`]);
  if (filters.sort !== "discount") labels.push(["sort", filters.sort === "price-asc" ? "现价从低到高" : "现价从高到低"]);
  if (filters.favoritesOnly) labels.push(["favorites", "仅看收藏"]);
  if (!labels.length) {
    elements.activeFilters.innerHTML = '<span class="filter-scope">当前显示全部符合门槛的商品</span>';
    return;
  }
  elements.activeFilters.innerHTML = labels.map(([key, label]) => (
    `<button class="active-filter" type="button" data-remove-filter="${key}" aria-label="移除条件 ${escapeHtml(label)}">${escapeHtml(label)} ×</button>`
  )).join("");
}

function resetFilterControls() {
  elements.source.value = "all";
  elements.discount.value = "40";
  elements.price.value = "all";
  elements.sort.value = "discount";
}

function clearFilters({ stage = false } = {}) {
  resetFilterControls();
  if (stage && mobileFilters.matches && elements.filterPanel.classList.contains("is-expanded")) {
    updateFilterPreview();
    return;
  }
  elements.search.value = "";
  commitFilterControls();
  state.favoritesOnly = false;
  elements.favoritesToggle.setAttribute("aria-pressed", "false");
  elements.favoritesToggle.classList.remove("is-active");
  applyFilters();
}

function setFilterPanelExpanded(expanded, { moveFocus = true, restore = true } = {}) {
  if (expanded) state.filterSnapshot = { ...state.appliedFilters };
  if (!expanded && restore && state.filterSnapshot) writeFilterControls(state.filterSnapshot);
  elements.filterToggle.setAttribute("aria-expanded", String(expanded));
  elements.filterPanel.classList.toggle("is-expanded", expanded);
  document.body.classList.toggle("filter-open", expanded);
  elements.filterFields.setAttribute("aria-modal", String(expanded));
  if (expanded) elements.filterFields.setAttribute("role", "dialog");
  else elements.filterFields.removeAttribute("role");
  if (!moveFocus) return;
  if (expanded) elements.source.focus();
  else elements.filterToggle.focus();
}

function openFilterPanel() {
  setFilterPanelExpanded(true);
  if (mobileFilters.matches && !history.state?.uniqloFilter) {
    history.pushState({ ...(history.state || {}), uniqloFilter: true }, "", location.href);
  }
}

function dismissFilterPanel({ applied = false, moveFocus = true } = {}) {
  setFilterPanelExpanded(false, { moveFocus, restore: !applied });
  if (history.state?.uniqloFilter) {
    state.filterHistoryReturn = applied ? "apply" : "cancel";
    history.back();
  }
  if (applied) state.filterSnapshot = null;
}

function updateFilterPreview() {
  const preview = filterProducts(state.products, {
    query: elements.search.value,
    ...filterControls(),
    favoritesOnly: state.favoritesOnly,
  }, state.favorites);
  elements.filterApply.textContent = `查看 ${preview.length} 款结果`;
}

function updateFilterToggle() {
  const filters = state.appliedFilters;
  const count = Number(filters.source !== "all")
    + Number(filters.minimumDiscount !== "40")
    + Number(filters.maximumPrice !== "all")
    + Number(filters.sort !== "discount");
  elements.filterToggle.textContent = count ? `筛选 · ${count}` : "筛选";
}

function removeFilter(key) {
  if (key === "query") elements.search.value = "";
  if (key === "source") state.appliedFilters.source = "all";
  if (key === "discount") state.appliedFilters.minimumDiscount = "40";
  if (key === "price") state.appliedFilters.maximumPrice = "all";
  if (key === "sort") state.appliedFilters.sort = "discount";
  if (key === "favorites") {
    state.favoritesOnly = false;
    elements.favoritesToggle.setAttribute("aria-pressed", "false");
    elements.favoritesToggle.classList.remove("is-active");
  }
  writeFilterControls(state.appliedFilters);
  applyFilters();
}

function toggleFavorite(code) {
  if (state.favorites.has(code)) {
    const saved = state.favoriteProducts.get(code);
    state.favorites.delete(code);
    state.favoriteProducts.delete(code);
    showToast(`已取消收藏 ${code}`, {
      actionLabel: "撤销",
      onAction: () => {
        state.favorites.add(code);
        if (saved) state.favoriteProducts.set(code, saved);
        saveFavorites();
        applyFilters({ resetPage: false });
      },
    });
  } else {
    state.favorites.add(code);
    const product = state.products.find((item) => String(item.item_code) === code);
    if (product) {
      state.favoriteProducts.set(code, {
        item_code: code,
        name: product.name,
        current_min_price: product.current_min_price,
        current_max_price: product.current_max_price,
        discount_percent: product.discount_percent,
      });
    }
    showToast(`已收藏 ${code}，仅保存在此浏览器`);
  }
  saveFavorites();
  applyFilters({ resetPage: false });
}

async function copyCode(code) {
  try {
    await copyText(code);
    showToast(`已复制商品编号 ${code}`);
  } catch {
    showToast("自动复制失败，请长按编号手动复制");
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("copy failed");
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
    await copyText(url);
  } catch {
    showToast("自动复制失败，请从地址栏复制链接");
    return;
  }
  showToast("分享链接已复制");
}

function shareCurrentResults() {
  writeUrlState();
  const shareableFilters = { ...currentFilters(), favoritesOnly: false };
  const shareableCount = filterProducts(state.products, shareableFilters, state.favorites).length;
  shareLink({
    title: "优衣库男装优惠筛选条件",
    text: state.favoritesOnly
      ? `此链接分享筛选条件，接收者预计看到 ${shareableCount} 款；本机收藏不会随链接分享。价格以页面标注的采集时间为准。`
      : `此链接分享筛选条件，当前找到 ${shareableCount} 款；打开时按最新发布数据重新计算。`,
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
  if (!product) {
    showMissingProduct(code, { updateUrl });
    return;
  }
  const history = historyForProduct(product, state.history);
  const firstSeen = firstSeenForProduct(product, state.history);
  const lowest = history.length ? Math.min(...history.map((entry) => entry.price)) : null;
  const favorite = state.favorites.has(code);
  const imagePath = `./assets/highlights/${encodeURIComponent(product.product_code)}.jpg`;
  const primaryOffer = product.offers[0];
  const observedRange = history.length
    ? `${escapeHtml(history[0].date)} 至 ${escapeHtml(history.at(-1).date)}`
    : "暂无记录";

  elements.dialogTitle.textContent = product.name;
  elements.dialogContent.innerHTML = `
    <div class="detail-product">
      <img class="detail-image" src="${imagePath}" alt="${escapeHtml(product.name)}" data-detail-image>
      <div>
        <p class="detail-price-label">当前观测价格${Number(product.current_max_price) > Number(product.current_min_price) ? "区间" : ""}</p>
        <p class="detail-price">${priceLabel(product)}</p>
        <p class="detail-updated">数据更新于 ${escapeHtml(formatTime(state.snapshot?.generated_at))}（北京时间）</p>
        <button class="copy-code" type="button" data-copy="${escapeHtml(code)}">商品编号 ${escapeHtml(code)}</button>
        <div class="detail-actions">
          ${primaryOffer ? `<a class="official-button" href="${escapeHtml(primaryOffer.url)}" target="_blank" rel="noopener noreferrer">前往官网查看</a>` : ""}
          <button class="detail-share" type="button" data-share-product="${escapeHtml(code)}">分享商品</button>
        </div>
      </div>
    </div>
    <div class="detail-summary">
      <div><span>原价</span><del>¥${money(product.original_price)}</del></div>
      <div><span>优惠幅度</span><strong>${escapeHtml(product.discount_percent)}%</strong></div>
      <div><span>有效观测</span><strong>${history.length}</strong></div>
      <div><span>首次观测</span><strong>${escapeHtml(firstSeen || "—")}</strong></div>
    </div>
    <button class="detail-favorite ${favorite ? "is-active" : ""}" type="button" data-favorite="${escapeHtml(code)}">${favorite ? "♥ 已收藏" : "♡ 收藏商品"}</button>
    <section class="history-panel">
      <div class="detail-heading"><h3>价格记录</h3><span>${history.length ? `${history.length}次观测` : "暂无记录"}</span></div>
      ${historyChart(history)}
      <p>${lowest === null ? "价格历史暂时不可用。" : `记录期最低价 ¥${money(lowest)} · 观测范围 ${observedRange}`}</p>
      <p class="detail-footnote">折线按真实日期间隔绘制；断线表示中间日期没有有效观测。历史值为相关官网页面当日最低观测价，不代表同一颜色或尺码持续有货。</p>
    </section>
    <details class="offer-panel">
      <summary>查看 ${product.offers.length} 个官网页面入口</summary>
      <div class="offer-list">
        ${product.offers.map((offer, index) => `<a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">官网入口 ${index + 1}<span>¥${money(offer.current_min_price)}${Number(offer.current_max_price) > Number(offer.current_min_price) ? `–¥${money(offer.current_max_price)}` : ""} · ${escapeHtml(offer.product_code)}</span></a>`).join("")}
      </div>
    </details>
    <p class="detail-footnote">${escapeHtml(product.sale_types.join("、"))} · ${escapeHtml(product.genders.join("、"))}。价格、库存、颜色和尺码以官网为准；本站为非官方项目。</p>`;
  const detailImage = elements.dialogContent.querySelector("[data-detail-image]");
  detailImage?.addEventListener("error", () => { detailImage.hidden = true; }, { once: true });
  if (detailImage?.complete && detailImage.naturalWidth === 0) detailImage.hidden = true;
  if (!elements.dialog.open) elements.dialog.showModal();
  if (updateUrl) updateProductParam(code, { push: true });
}

function showMissingProduct(code, { updateUrl = true } = {}) {
  elements.dialogTitle.textContent = "当前数据中未找到该商品";
  elements.dialogContent.innerHTML = `
    <div class="missing-product">
      <p>商品编号 ${escapeHtml(code)} 当前不在发布清单中。这不能证明商品已经停售或售罄。</p>
      <button class="copy-code" type="button" data-copy="${escapeHtml(code)}">复制商品编号 ${escapeHtml(code)}</button>
      <button class="secondary-button" type="button" data-close-dialog>返回优惠清单</button>
    </div>`;
  if (!elements.dialog.open) elements.dialog.showModal();
  if (updateUrl) updateProductParam(code, { push: true });
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
  const times = history.map((entry) => new Date(`${entry.date}T00:00:00Z`).getTime());
  const start = Math.min(...times);
  const end = Math.max(...times);
  const span = end - start || 1;
  const pointFor = (entry, index) => {
    const x = 8 + ((times[index] - start) / span) * 284;
    const y = 12 + ((max - entry.price) / range) * 76;
    return { x, y, entry };
  };
  const points = history.map(pointFor);
  const segments = [];
  let segment = [];
  points.forEach((point, index) => {
    if (index && times[index] - times[index - 1] > 86_400_000) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    segment.push(point);
  });
  if (segment.length) segments.push(segment);
  return `
    <svg class="history-chart" viewBox="0 0 300 104" role="img" aria-label="商品价格变化折线图">
      <line x1="8" y1="88" x2="292" y2="88"></line>
      ${segments.map((items) => `<polyline points="${items.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}"></polyline>`).join("")}
      ${points.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${escapeHtml(point.entry.date)}：¥${money(point.entry.price)}</title></circle>`).join("")}
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
let toastAction;
function showToast(message, { actionLabel = "", onAction = null } = {}) {
  clearTimeout(toastTimer);
  toastAction = onAction;
  elements.toast.innerHTML = `${escapeHtml(message)}${actionLabel ? ` <button type="button" data-toast-action>${escapeHtml(actionLabel)}</button>` : ""}`;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    toastAction = null;
  }, actionLabel ? 4200 : 1800);
}

function handleAction(event) {
  if (event.target.closest("[data-toast-action]")) {
    const action = toastAction;
    elements.toast.classList.remove("is-visible");
    toastAction = null;
    action?.();
    return;
  }
  if (event.target.closest("[data-close-dialog]")) {
    closeProductDialog();
    return;
  }
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
elements.search.addEventListener("input", () => {
  applyFilters();
  if (mobileFilters.matches && elements.filterPanel.classList.contains("is-expanded")) updateFilterPreview();
});
[elements.source, elements.discount, elements.price, elements.sort]
  .forEach((element) => element.addEventListener("change", () => {
    if (mobileFilters.matches && elements.filterPanel.classList.contains("is-expanded")) {
      updateFilterPreview();
      return;
    }
    const previousSort = state.appliedFilters.sort;
    commitFilterControls();
    applyFilters();
    if (element === elements.sort && previousSort !== state.appliedFilters.sort && state.appliedFilters.sort !== "discount") {
      document.querySelector("#products")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }));
elements.filterPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  commitFilterControls();
  applyFilters();
});
elements.filterToggle.addEventListener("click", () => {
  const expanded = elements.filterToggle.getAttribute("aria-expanded") !== "true";
  if (expanded) openFilterPanel();
  else dismissFilterPanel();
});
elements.filterBackdrop.addEventListener("click", () => dismissFilterPanel());
elements.filterClose.addEventListener("click", () => dismissFilterPanel());
elements.filterApply.addEventListener("click", () => {
  const previousSort = state.appliedFilters.sort;
  commitFilterControls();
  applyFilters();
  dismissFilterPanel({ applied: true });
  if (previousSort !== state.appliedFilters.sort && state.appliedFilters.sort !== "discount") {
    document.querySelector("#products")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.filterPanel.classList.contains("is-expanded")) {
    dismissFilterPanel();
    return;
  }
  if (event.key === "Tab" && elements.filterPanel.classList.contains("is-expanded") && mobileFilters.matches) {
    const focusable = [...elements.filterFields.querySelectorAll("button, select, input, [href]")]
      .filter((item) => !item.disabled && item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
mobileFilters.addEventListener("change", (event) => {
  if (!event.matches) {
    dismissFilterPanel({ applied: true, moveFocus: false });
    commitFilterControls();
    applyFilters();
  } else {
    writeFilterControls(state.appliedFilters);
  }
});
elements.clearFilters.addEventListener("click", () => clearFilters({ stage: true }));
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
  closeProductDialog();
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) {
    closeProductDialog();
  }
});
elements.dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeProductDialog();
});

function closeProductDialog({ fromHistory = false } = {}) {
  if (elements.dialog.open) elements.dialog.close();
  if (fromHistory) return;
  if (history.state?.uniqloProduct && new URLSearchParams(location.search).has("product")) {
    history.back();
  } else {
    updateProductParam();
  }
}

window.addEventListener("popstate", () => {
  if (state.filterHistoryReturn) {
    const mode = state.filterHistoryReturn;
    state.filterHistoryReturn = null;
    if (mode === "apply") writeUrlState();
    return;
  }
  if (elements.filterPanel.classList.contains("is-expanded") && !history.state?.uniqloFilter) {
    setFilterPanelExpanded(false, { restore: true });
    return;
  }
  readUrlState();
  if (state.products.length) applyFilters();
  const code = new URLSearchParams(location.search).get("product");
  if (code) showProduct(code, { updateUrl: false });
  else closeProductDialog({ fromHistory: true });
});

if ("ResizeObserver" in window) {
  const filterObserver = new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--filter-bar-height", `${Math.ceil(entry.contentRect.height)}px`);
  });
  filterObserver.observe(elements.filterPanel);
}

window.addEventListener("online", () => showToast("网络已恢复"));
window.addEventListener("offline", () => showNotice("当前处于离线状态，页面可能显示缓存数据。", "warning"));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

readUrlState();
loadData();
