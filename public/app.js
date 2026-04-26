const API = "http://localhost:5000";

let chartInstance = null;

/* ---------------- LOGIN ---------------- */
async function login() {
  const username = document.getElementById("username")?.value;
  const password = document.getElementById("password")?.value;

  try {
    const res = await fetch(API + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      const msg = document.getElementById("msg");
      if (msg) msg.innerText = data.message || "Invalid login";
      return;
    }

    if (data.role === "manager") window.location.href = "manager.html";
    else window.location.href = "owner.html";

  } catch (err) {
    console.error("Login error:", err);
    alert("Server error during login");
  }
}

/* ---------------- LOGOUT ---------------- */
function logout() {
  window.location.href = "index.html";
}

/* ---------------- LOAD PRODUCTS (FIXED + SAFE RETRY) ---------------- */
async function loadProducts() {
  try {
    const res = await fetch(API + "/products");

    if (!res.ok) throw new Error("Network error");

    const data = await res.json();
    renderTable(data);

  } catch (err) {
    console.error("Load error:", err);

    // silent retry (fixes your annoying popup issue)
    setTimeout(async () => {
      try {
        const res = await fetch(API + "/products");
        const data = await res.json();
        renderTable(data);
      } catch (e) {
        console.error("Retry failed:", e);
      }
    }, 800);
  }
}

/* ---------------- LOW STOCK SYSTEM ---------------- */
function getStockStatus(qty) {
  if (qty < 0) return `<span class="badge bg-danger">URGENT STOCK REQUIRED</span>`;
  if (qty === 0) return `<span class="badge bg-dark">OUT</span>`;
  if (qty <= 5) return `<span class="badge bg-warning text-dark">LOW</span>`;
  return `<span class="badge bg-success">OK</span>`;
}

/* ---------------- RENDER ---------------- */
function renderTable(data) {
  let total = 0;
  let totalValue = 0;
  const categories = {};

  const isOwner = window.location.pathname.includes("owner");

  let html = `
  <table class="table table-bordered table-hover">
    <thead class="table-dark">
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>Category</th>
        <th>Details</th>
        <th>Unit</th>
        <th>Qty</th>
        <th>Status</th>
        <th>Price</th>
        ${isOwner ? "" : "<th>Actions</th>"}
      </tr>
    </thead>
    <tbody>
  `;

  data.forEach(p => {
    const qty = Number(p.quantity || 0);
    const price = Number(p.price || 0);

    if(qty>0) total += qty;
    if(qty>0) totalValue += qty * price;

    if(qty>0){categories[p.category] = (categories[p.category] || 0) + qty;}

    html += `
      <tr>
        <td>${p.code || ""}</td>
        <td>${p.name || ""}</td>
        <td>${p.category || ""}</td>
        <td>${p.details || ""}</td>
        <td>${p.unit || ""}</td>
        <td>${qty}</td>
        <td>${getStockStatus(qty)}</td>
        <td>${price}</td>

        ${isOwner ? "" : `
        <td>
          <button onclick="editProduct(${p.id})" class="btn btn-warning btn-sm">Edit</button>
          <button onclick="deleteProduct(${p.id})" class="btn btn-danger btn-sm">Delete</button>
        </td>`}
      </tr>
    `;
  });

  html += "</tbody></table>";

  document.getElementById("table").innerHTML = html;

  // dashboard stats (safe check)
  const t = document.getElementById("total");
  if (t) t.innerText = "Total Quantity: " + total;

  const tp = document.getElementById("totalProducts");
  if (tp) tp.innerText = data.length;

  const tq = document.getElementById("totalQty");
  if (tq) tq.innerText = total;

  const tv = document.getElementById("totalValue");
  if (tv) tv.innerText = totalValue.toFixed(2);

  const tc = document.getElementById("totalCategories");
  if (tc) tc.innerText = Object.keys(categories).length;

  drawChart(categories);
}

/* ---------------- CHART (NOW WORKS ON OWNER TOO) ---------------- */
function drawChart(categories) {
  const ctx = document.getElementById("stockChart");

  if (!ctx) return;

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(categories),
      datasets: [{
        label: "Stock",
        data: Object.values(categories),
        backgroundColor: "#6b8e23"
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/* ---------------- ADD PRODUCT ---------------- */
async function addProduct() {
  const qty = Number(document.getElementById("quantity").value);

  const product = {
    code: document.getElementById("code").value.trim(),
    name: document.getElementById("name").value.trim(),
    category: document.getElementById("category").value.trim(),
    details: document.getElementById("details").value.trim(),
    unit: document.getElementById("unit").value.trim(),
    quantity: qty,
    price: document.getElementById("price").value
  };

  // VALIDATION
  if (!product.name || !product.code) {
    alert("Name and Code required");
    return;
  }

  if (product.price < 0) {
    alert("Price cannot be negative");
    return;
  }

  try {
    let res;

    if (window.editId) {
      res = await fetch(API + "/products/" + window.editId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product)
      });
      window.editId = null;
    } else {
      res = await fetch(API + "/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product)
      });
    }

    const data = await res.json();

    if (!res.ok || !data.success) {
      alert(data.message || "Operation failed");
      return;
    }

    clearForm();
    loadProducts();

  } catch (err) {
    console.error(err);
    alert("Server error");
  }
}

/* ---------------- EDIT ---------------- */
async function editProduct(id) {
  try {
    const res = await fetch(API + "/products");
    const data = await res.json();

    const p = data.find(x => x.id === id);
    if (!p) return;

    code.value = p.code || "";
    name.value = p.name || "";
    category.value = p.category || "";
    details.value = p.details || "";
    unit.value = p.unit || "";
    quantity.value = p.quantity || "";
    price.value = p.price || "";

    window.editId = id;

  } catch (err) {
    console.error(err);
  }
}

/* ---------------- DELETE ---------------- */
async function deleteProduct(id) {
  if (!confirm("Delete?")) return;

  try {
    const res = await fetch(API + "/products/" + id, {
      method: "DELETE"
    });

    const data = await res.json();

    if (!data.success) return;

    loadProducts();

  } catch (err) {
    console.error(err);
  }
}

/* ---------------- SEARCH ---------------- */
function filterTable() {
  const q = document.getElementById("search")?.value.toLowerCase();
  if (!q) return loadProducts();

  fetch(API + "/products")
    .then(res => res.json())
    .then(data => {
      const filtered = data.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q)
      );

      renderTable(filtered);
    });
}

/* ---------------- REPORT ---------------- */
function downloadReport() {
  window.open(API + "/report", "_blank");
}

/* ---------------- CLEAR ---------------- */
function clearForm() {
  ["code","name","category","details","unit","quantity","price"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
}

/* ---------------- INIT ---------------- */
window.onload = function () {
  if (document.getElementById("table")) {
    loadProducts();
  }
};

setTimeout(() => {
  const search = document.getElementById("search");
  if (search) search.addEventListener("input", filterTable);
}, 500);