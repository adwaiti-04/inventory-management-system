"use strict";

const InventoryApp = (() => {
  // ---------- State ----------
  let currentProducts = [];
  let isEditMode = false;
  let editingId = null;
  let debounceTimer = null;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    tbody: $("productTableBody"),
    empty: $("emptyState"),
    search: $("searchInput"),
    category: $("categoryFilter"),
    overlay: $("modalOverlay"),
    title: $("modalTitle"),
    form: $("productForm"),
    formError: $("formError"),
    saveBtn: $("saveBtn"),
    pid: $("productId"),
    name: $("productName"),
    cat: $("productCategory"),
    qty: $("productQty"),
    price: $("productPrice"),
    catList: $("categoryList"),
    toasts: $("toast-container"),
  };

  // ---------- Helpers ----------
  const currency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML.replace(/"/g, "&quot;");
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* non-JSON response */
    }
    if (!res.ok)
      throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function statusBadge(qty) {
    if (qty === 0)
      return '<span class="badge badge-danger">Out of Stock</span>';
    if (qty <= 5) return '<span class="badge badge-warning">Low Stock</span>';
    return '<span class="badge badge-success">In Stock</span>';
  }

  // ---------- Notifications ----------
  function showNotification(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    els.toasts.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 400);
    }, 3000);
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

  async function fetchProducts(
    searchQuery = els.search.value,
    categoryFilter = els.category.value,
  ) {
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

  function updateCategories(categories, selected) {
    els.category.innerHTML =
      '<option value="">All categories</option>' +
      categories
        .map(
          (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`,
        )
        .join("");
    els.category.value = categories.includes(selected) ? selected : "";
    els.catList.innerHTML = categories
      .map((c) => `<option value="${escapeHtml(c)}"></option>`)
      .join("");
  }

  function renderTable(products) {
    if (!products.length) {
      els.tbody.innerHTML = "";
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;
    els.tbody.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td class="mono">${escapeHtml(p.product_id)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td class="num">${p.quantity}</td>
        <td class="num">${currency.format(p.price)}</td>
        <td>${statusBadge(p.quantity)}</td>
        <td>
          <button class="btn btn-sm btn-edit" data-action="edit" data-id="${escapeHtml(p.product_id)}">Edit</button>
          <button class="btn btn-sm btn-delete" data-action="delete" data-id="${escapeHtml(p.product_id)}">Delete</button>
        </td>
      </tr>`,
      )
      .join("");
  }

  async function refresh() {
    await Promise.all([fetchDashboard(), fetchProducts()]);
  }

  // ---------- Modal ----------
  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = !msg;
  }

  function openAddModal() {
    isEditMode = false;
    editingId = null;
    els.title.textContent = "Add Product";
    els.form.reset();
    els.pid.disabled = false;
    showError("");
    els.overlay.hidden = false;
    els.pid.focus();
  }

  function openEditModal(productId) {
    const p = currentProducts.find((x) => x.product_id === productId);
    if (!p) return showNotification("Product not found.", "error");
    isEditMode = true;
    editingId = productId;
    els.title.textContent = "Edit Product";
    els.pid.value = p.product_id;
    els.pid.disabled = true;
    els.name.value = p.name;
    els.cat.value = p.category;
    els.qty.value = p.quantity;
    els.price.value = p.price;
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
    if (
      els.qty.value === "" ||
      !Number.isInteger(Number(els.qty.value)) ||
      Number(els.qty.value) < 0
    )
      return "Quantity must be a whole number, 0 or greater.";
    if (
      els.price.value === "" ||
      Number.isNaN(Number(els.price.value)) ||
      Number(els.price.value) < 0
    )
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
        await api(`/api/products/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showNotification("Product updated.", "success");
      } else {
        await api("/api/products", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showNotification("Product added.", "success");
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
    if (!window.confirm(`Delete product ${productId}? This cannot be undone.`))
      return;
    try {
      await api(`/api/products/${encodeURIComponent(productId)}`, {
        method: "DELETE",
      });
      showNotification("Product deleted.", "warning");
      await refresh();
    } catch (err) {
      showNotification(err.message, "error");
    }
  }

  // ---------- Init ----------
  function init() {
    $("addProductBtn").addEventListener("click", openAddModal);
    $("cancelBtn").addEventListener("click", closeModal);
    els.form.addEventListener("submit", handleFormSubmit);
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.overlay.hidden) closeModal();
    });

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

  return {
    init,
    fetchDashboard,
    fetchProducts,
    renderTable,
    handleFormSubmit,
    openAddModal,
    openEditModal,
    closeModal,
    confirmDelete,
    showNotification,
  };
})();

document.addEventListener("DOMContentLoaded", InventoryApp.init);
