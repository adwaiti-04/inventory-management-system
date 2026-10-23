"use strict";

const InventoryApp = (() => {
  // ---------- State ----------
  let currentProducts = [];
  let isEditMode = false;
  let editingId = null;
  let debounceTimer = null;
  const THEMES = [["mix", "🌗 Mix"], ["light", "☀️ Light"], ["dark", "🌙 Dark"]];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    tbody: $("productTableBody"), empty: $("emptyState"),
    search: $("searchInput"), category: $("categoryFilter"),
    overlay: $("modalOverlay"), title: $("modalTitle"), sticker: $("modalSticker"), form: $("productForm"),
    formError: $("formError"), saveBtn: $("saveBtn"),
    pid: $("productId"), name: $("productName"), cat: $("productCategory"),
    qty: $("productQty"), price: $("productPrice"), catList: $("categoryList"),
    toasts: $("toast-container"), restock: $("restockStrip"), themeBtn: $("themeBtn"),
  };

  // ---------- Helpers ----------
  const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const currencyFull = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML.replace(/"/g, "&quot;");
  }

  async function api(url, options = {}) {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
    let data = {};
    try { data = await res.json(); } catch (_) { /* non-JSON response */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const EMOJI_RULES = [
    [/laptop|notebook|computer|pc/i, "💻"], [/mouse/i, "🖱️"], [/keyboard/i, "⌨️"],
    [/cable|charger|wire|usb/i, "🔌"], [/bottle|flask|cup|mug/i, "🧴"], [/phone|mobile/i, "📱"],
    [/headphone|earbud|speaker|audio/i, "🎧"], [/monitor|screen|display|tv/i, "🖥️"],
    [/book|notebook|paper|pen|stationery/i, "📚"], [/lamp|light|bulb/i, "💡"], [/bag|backpack/i, "🎒"],
    [/electronic/i, "⚡"], [/access/i, "🧩"], [/home|kitchen|furniture/i, "🏠"], [/cloth|apparel|shirt/i, "👕"],
    [/food|snack|drink/i, "🍪"],
  ];
  function emojiFor(name, category) {
    for (const [re, e] of EMOJI_RULES) if (re.test(name)) return e;
    for (const [re, e] of EMOJI_RULES) if (re.test(category)) return e;
    return "📦";
  }
  function hashIdx(text, mod) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return h % mod;
  }

  function statusBadge(qty) {
    if (qty === 0) return '<span class="badge badge-danger">😵 Out of Stock</span>';
    if (qty <= 5) return '<span class="badge badge-warning">⚠️ Low Stock</span>';
    return '<span class="badge badge-success">😎 In Stock</span>';
  }

  // ---------- Notifications ----------
  function showNotification(message, type = "success") {
    const icon = { success: "✅", error: "❌", warning: "⚠️" }[type] || "💬";
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = `${icon} ${message}`;
    els.toasts.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  function confetti() {
    const pieces = ["🎉", "✨", "⭐", "🎊", "💜", "🚀"];
    for (let i = 0; i < 14; i++) {
      const s = document.createElement("span");
      s.className = "confetti";
      s.textContent = pieces[i % pieces.length];
      s.style.left = `${35 + Math.random() * 30}vw`;
      s.style.top = "55vh";
      s.style.setProperty("--dx", `${(Math.random() - 0.5) * 320}px`);
      s.style.setProperty("--rot", `${(Math.random() - 0.5) * 540}deg`);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  // ---------- Theme ----------
  function applyTheme(name) {
    const entry = THEMES.find((t) => t[0] === name) || THEMES[0];
    document.documentElement.dataset.theme = entry[0];
    els.themeBtn.textContent = entry[1];
    try { localStorage.setItem("stockroom-theme", entry[0]); } catch (_) { /* storage blocked */ }
  }
  function cycleTheme() {
    const i = THEMES.findIndex((t) => t[0] === document.documentElement.dataset.theme);
    applyTheme(THEMES[(i + 1) % THEMES.length][0]);
  }

  // ---------- Charts (hand-written SVG) ----------
  function renderDonut(s) {
    const total = s.in_stock + s.low_stock + s.out_of_stock;
    const box = $("donutChart");
    if (!total) { box.innerHTML = '<p class="chart-empty">📭 Add products to see stock health.</p>'; return; }
    const parts = [["c-in", s.in_stock, "😎 In stock"], ["c-low", s.low_stock, "⚠️ Low stock"], ["c-out", s.out_of_stock, "😵 Out of stock"]];
    let offset = 25; // start at 12 o'clock
    const arcs = parts.filter((p) => p[1] > 0).map(([cls, n, label]) => {
      const pct = (n / total) * 100;
      const el = `<circle class="seg ${cls}" cx="21" cy="21" r="15.9155" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${offset}"><title>${label}: ${n}</title></circle>`;
      offset -= pct;
      return el;
    }).join("");
    const legend = parts.map(([cls, n, label]) => `<li><span class="dot ${cls}"></span>${label}: <strong>${n}</strong></li>`).join("");
    box.innerHTML = `<div class="donut-wrap">
      <svg viewBox="0 0 42 42" role="img" aria-label="Stock health donut chart">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--soft)" stroke-width="5.2"></circle>${arcs}
        <text class="donut-num" x="21" y="22.5">${total}</text><text class="donut-sub" x="21" y="26.5">products</text>
      </svg><ul class="legend">${legend}</ul></div>`;
  }

  function renderBars(cats) {
    const box = $("barChart");
    if (!cats.length) { box.innerHTML = '<p class="chart-empty">📭 No categories yet.</p>'; return; }
    const data = cats.slice(0, 6);
    const W = 340, H = 210, padB = 44, padT = 22, gap = 12;
    const max = Math.max(...data.map((c) => c.quantity), 1);
    const bw = (W - gap * (data.length + 1)) / data.length;
    const bars = data.map((c, i) => {
      const h = Math.max((c.quantity / max) * (H - padB - padT), 3);
      const x = gap + i * (bw + gap), y = H - padB - h;
      const label = c.category.length > 9 ? c.category.slice(0, 8) + "…" : c.category;
      return `<rect class="bar b${i % 5}" x="${x}" y="${y}" width="${bw}" height="${h}" rx="5"><title>${escapeHtml(c.category)}: ${c.quantity} units, ${c.items} products</title></rect>
        <text class="val-text" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${c.quantity}</text>
        <text class="axis-text" x="${x + bw / 2}" y="${H - 28}" text-anchor="middle">${emojiFor("", c.category)}</text>
        <text class="axis-text" x="${x + bw / 2}" y="${H - 14}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }).join("");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Units per category bar chart">
      <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="var(--line)" stroke-width="2"></line>${bars}</svg>`;
  }

  function renderValueChart(top) {
    const box = $("valueChart");
    if (!top.length || !top[0].value) { box.innerHTML = '<p class="chart-empty">📭 No stock value yet.</p>'; return; }
    const W = 340, rowH = 38, labelW = 100, H = top.length * rowH + 6;
    const max = Math.max(...top.map((t) => t.value), 1);
    const rows = top.map((t, i) => {
      const w = Math.max((t.value / max) * (W - labelW - 56), 4), y = i * rowH + 4;
      const label = t.name.length > 12 ? t.name.slice(0, 11) + "…" : t.name;
      return `<text class="axis-text" x="0" y="${y + 19}">${emojiFor(t.name, "")} ${escapeHtml(label)}</text>
        <rect class="bar b${i % 5}" x="${labelW}" y="${y + 6}" width="${w}" height="22" rx="6"><title>${escapeHtml(t.name)}: ${currencyFull.format(t.value)}</title></rect>
        <text class="val-text" x="${labelW + w + 6}" y="${y + 22}">${compact.format(t.value)}</text>`;
    }).join("");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Most valuable items bar chart">${rows}</svg>`;
  }

  async function fetchAnalytics() {
    try {
      const a = await api("/api/analytics");
      renderDonut(a.status);
      renderBars(a.by_category);
      renderValueChart(a.top_value);
    } catch (err) {
      showNotification(err.message, "error");
    }
  }

  function renderRestock(all) {
    const need = all.filter((p) => p.quantity <= 5).sort((a, b) => a.quantity - b.quantity).slice(0, 6);
    if (!need.length) {
      els.restock.innerHTML = '<span class="chip ok">🎉 Everything is well stocked</span>';
      return;
    }
    els.restock.innerHTML = '<span class="restock-title">🛒 Restock soon:</span>' + need.map((p) =>
      `<span class="chip ${p.quantity === 0 ? "out" : "low"}">${emojiFor(p.name, p.category)} ${escapeHtml(p.name)} · ${p.quantity} left</span>`).join("");
  }

  // ---------- Data ----------
  async function fetchDashboard() {
    try {
      const d = await api("/api/dashboard");
      $("statProducts").textContent = d.total_products;
      $("statStock").textContent = d.total_stock;
      $("statLow").textContent = d.low_stock;
      $("statValue").textContent = currency.format(d.inventory_value);
    } catch (err) {
      showNotification(err.message, "error");
    }
  }

  async function fetchProducts(searchQuery = els.search.value, categoryFilter = els.category.value) {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (categoryFilter) params.set("category", categoryFilter);
    try {
      const data = await api(`/api/products?${params.toString()}`);
      currentProducts = data.products;
      updateCategories(data.categories, categoryFilter);
      renderTable(currentProducts);
    } catch (err) {
      showNotification(err.message, "error");
    }
  }

  async function fetchRestock() {
    try { renderRestock((await api("/api/products")).products); } catch (_) { /* non-critical */ }
  }

  function updateCategories(categories, selected) {
    els.category.innerHTML = '<option value="">🗂️ All categories</option>' +
      categories.map((c) => `<option value="${escapeHtml(c)}">${emojiFor("", c)} ${escapeHtml(c)}</option>`).join("");
    els.category.value = categories.includes(selected) ? selected : "";
    els.catList.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  function renderTable(products) {
    if (!products.length) {
      els.tbody.innerHTML = "";
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;
    els.tbody.innerHTML = products.map((p) => `
      <tr>
        <td class="mono">${escapeHtml(p.product_id)}</td>
        <td><div class="pname"><span class="avatar av${hashIdx(p.name, 5)}">${emojiFor(p.name, p.category)}</span>${escapeHtml(p.name)}</div></td>
        <td>${escapeHtml(p.category)}</td>
        <td class="num"><strong>${p.quantity}</strong></td>
        <td class="num">${currencyFull.format(p.price)}</td>
        <td>${statusBadge(p.quantity)}</td>
        <td>
          <button class="btn btn-sm btn-edit" data-action="edit" data-id="${escapeHtml(p.product_id)}">✏️ Edit</button>
          <button class="btn btn-sm btn-delete" data-action="delete" data-id="${escapeHtml(p.product_id)}">🗑️ Delete</button>
        </td>
      </tr>`).join("");
  }

  async function refresh() {
    await Promise.all([fetchDashboard(), fetchProducts(), fetchAnalytics(), fetchRestock()]);
  }

  // ---------- Modal ----------
  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = !msg;
  }

  function openAddModal() {
    isEditMode = false; editingId = null;
    els.title.textContent = "Add Product";
    els.sticker.textContent = "🆕";
    els.form.reset();
    els.pid.disabled = false;
    showError("");
    els.overlay.hidden = false;
    els.pid.focus();
  }

  function openEditModal(productId) {
    const p = currentProducts.find((x) => x.product_id === productId);
    if (!p) return showNotification("Product not found.", "error");
    isEditMode = true; editingId = productId;
    els.title.textContent = "Edit Product";
    els.sticker.textContent = "✏️";
    els.pid.value = p.product_id; els.pid.disabled = true;
    els.name.value = p.name; els.cat.value = p.category;
    els.qty.value = p.quantity; els.price.value = p.price;
    showError("");
    els.overlay.hidden = false;
    els.name.focus();
  }

  function closeModal() {
    els.overlay.hidden = true;
    els.form.reset();
    showError("");
  }

  // ---------- Form ----------
  function validate(payload) {
    if (!isEditMode && !payload.product_id) return "Product ID is required.";
    if (!payload.name) return "Product name is required.";
    if (!payload.category) return "Category is required.";
    if (els.qty.value === "" || !Number.isInteger(Number(els.qty.value)) || Number(els.qty.value) < 0)
      return "Quantity must be a whole number, 0 or greater.";
    if (els.price.value === "" || Number.isNaN(Number(els.price.value)) || Number(els.price.value) < 0)
      return "Price must be a number, 0 or greater.";
    return "";
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const payload = {
      product_id: els.pid.value.trim(),
      name: els.name.value.trim(),
      category: els.cat.value.trim(),
      quantity: Number(els.qty.value),
      price: Number(els.price.value),
    };
    const problem = validate(payload);
    if (problem) return showError(problem);

    els.saveBtn.disabled = true;
    try {
      if (isEditMode) {
        await api(`/api/products/${encodeURIComponent(editingId)}`, { method: "PUT", body: JSON.stringify(payload) });
        showNotification("Product updated.", "success");
      } else {
        await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
        showNotification("Product added.", "success");
        confetti();
      }
      closeModal();
      await refresh();
    } catch (err) {
      showError(err.message);
      showNotification(err.message, "error");
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  async function confirmDelete(productId) {
    if (!window.confirm(`Delete product ${productId}? This cannot be undone.`)) return;
    try {
      await api(`/api/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
      showNotification("Product deleted.", "warning");
      await refresh();
    } catch (err) {
      showNotification(err.message, "error");
    }
  }

  // ---------- Init ----------
  function init() {
    let saved = "mix";
    try { saved = localStorage.getItem("stockroom-theme") || "mix"; } catch (_) { /* storage blocked */ }
    applyTheme(saved);

    els.themeBtn.addEventListener("click", cycleTheme);
    $("addProductBtn").addEventListener("click", openAddModal);
    $("cancelBtn").addEventListener("click", closeModal);
    els.form.addEventListener("submit", handleFormSubmit);
    els.overlay.addEventListener("click", (e) => { if (e.target === els.overlay) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.overlay.hidden) closeModal(); });

    els.tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "edit") openEditModal(btn.dataset.id);
      else confirmDelete(btn.dataset.id);
    });

    els.search.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchProducts(), 300);
    });
    els.category.addEventListener("change", () => fetchProducts());

    refresh();
  }

  return { init, fetchDashboard, fetchProducts, renderTable, handleFormSubmit,
           openAddModal, openEditModal, closeModal, confirmDelete, showNotification };
})();

document.addEventListener("DOMContentLoaded", InventoryApp.init);
