export const DISPLAY_DISCOUNT_MIN = 40;

export function discountSortKey(product) {
  const percent = Number.isFinite(product.discount_percent)
    ? product.discount_percent
    : -1;
  const original = Number(product.original_price);
  const current = Number(product.current_min_price);
  const amount = Number.isFinite(original) && Number.isFinite(current)
    ? original - current
    : -1;
  return [-percent, -amount, String(product.item_code || "")];
}

export function compareSortKeys(left, right) {
  const a = discountSortKey(left);
  const b = discountSortKey(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export function groupProducts(products) {
  const grouped = new Map();
  [...products].sort(compareSortKeys).forEach((product) => {
    const key = String(product.item_code || product.product_code || "");
    if (!key) return;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...product,
        sale_types: [],
        genders: [],
        offers: [],
      });
    }
    const entry = grouped.get(key);
    // Products are sorted by discount before grouping, so the first row is the
    // best current offer. Keep that offer's own price range instead of merging
    // prices from other product pages for the same item code. Different pages
    // can carry stale or lower-discount prices and are links, not variants.
    entry.sale_types = [...new Set([
      ...entry.sale_types,
      ...(product.sale_types || []),
    ])];
    entry.genders = [...new Set([
      ...entry.genders,
      ...String(product.gender || "").split("、").filter(Boolean),
    ])];
    entry.offers.push({
      product_code: product.product_code,
      url: product.url,
      current_min_price: product.current_min_price,
      current_max_price: product.current_max_price,
    });
  });
  return [...grouped.values()].sort(compareSortKeys);
}

export function filterProducts(products, filters, favorites = new Set()) {
  const query = String(filters.query || "").trim().toLocaleLowerCase("zh-CN");
  const minimumDiscount = Number(filters.minimumDiscount || DISPLAY_DISCOUNT_MIN);
  const maximumPrice = filters.maximumPrice === "all"
    ? Number.POSITIVE_INFINITY
    : Number(filters.maximumPrice);

  const result = products.filter((product) => {
    if (filters.favoritesOnly && !favorites.has(String(product.item_code))) return false;
    if (Number(product.discount_percent) < minimumDiscount) return false;
    if (Number(product.current_min_price) > maximumPrice) return false;
    if (filters.source !== "all" && !(product.sale_types || []).includes(filters.source)) return false;
    if (query) {
      const haystack = [product.item_code, product.name, product.product_code]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (filters.sort === "price-asc") {
    return result.sort((a, b) => Number(a.current_min_price) - Number(b.current_min_price) || compareSortKeys(a, b));
  }
  if (filters.sort === "price-desc") {
    return result.sort((a, b) => Number(b.current_min_price) - Number(a.current_min_price) || compareSortKeys(a, b));
  }
  return result.sort(compareSortKeys);
}

export function officialImageUrl(product) {
  const candidate = String(product?.image_url || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.hostname === "www.uniqlo.cn"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function historyForProduct(product, history) {
  if (!history || !Array.isArray(history.days)) return [];
  const codes = new Set((product.offers || []).map((offer) => offer.product_code));
  return history.days.flatMap((day) => {
    const values = [...codes]
      .map((code) => day.prices?.[code]?.[0])
      .filter((value) => Number.isFinite(Number(value)))
      .map(Number);
    return values.length ? [{ date: day.date, price: Math.min(...values) }] : [];
  });
}

export function firstSeenForProduct(product, history) {
  const dates = (product.offers || [])
    .map((offer) => history?.first_seen?.[offer.product_code])
    .filter(Boolean)
    .sort();
  return dates[0] || "";
}

export function parseChangeSummary(markdown = "") {
  const find = (label) => {
    const match = markdown.match(new RegExp(`${label}：\\s*(\\d+)\\s*条`));
    return match ? Number(match[1]) : null;
  };
  return {
    added: find("新增优惠"),
    drops: find("降价"),
    increases: find("涨价"),
    missing: find("本次未检出"),
  };
}
