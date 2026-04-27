const express = require("express");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { Pool } = require("pg");
const PORT = process.env.PORT || 5000;

const app = express();

// ---------------- SECURITY + LIMITS ----------------
app.use(cors({
  origin:["http://localhost:5173",
    "https://stock-system-react.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Server", "Stock-ERP-System");
  next();
});

// ---------------- RATE LIMIT ----------------
const requestMap = {};
const LIMIT = 120;
const WINDOW = 10 * 60 * 1000;

app.use((req, res, next) => {
  const ip = req.ip;

  if (!requestMap[ip]) {
    requestMap[ip] = { count: 1, start: Date.now() };
  } else {
    requestMap[ip].count++;
  }

  const data = requestMap[ip];

  if (Date.now() - data.start > WINDOW) {
    requestMap[ip] = { count: 1, start: Date.now() };
    return next();
  }

  if (data.count > LIMIT) {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Slow down."
    });
  }

  next();
});


// ---------------- POSTGRESQL LAYER (PHASE 7) ----------------
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pgPool.connect()
  .then(() => console.log("PostgreSQL connected successfully"))
  .catch(err => console.log("PostgreSQL not active yet:", err.message));

// ---------------- SAFE PG QUERY HELPER ----------------
async function query(sql, params = []) {
  return pgPool.query(sql, params);
}

// ---------------- SAFE ERROR HANDLER ----------------
function handleDbError(res, err, message = "Database error") {
  console.error(err);
  return res.status(500).json({
    success: false,
    message,
    error: err.message
  });
}

// ---------------- HELPERS ----------------
function sanitizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function safeNumber(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return num;
}

// ---------------- STOCK STATUS ----------------
function getStockStatus(qty) {
  if (qty < 0) return "URGENT_STOCK_REQUIRED";
  if (qty === 0) return "OUT_OF_STOCK";
  if (qty <= 5) return "LOW_STOCK";
  return "OK";
}

// ---------------- VALIDATION ----------------
function validateProduct(d) {
  if (!d.name || !d.code) return "Name and Code are required";
  if (String(d.name).length > 100) return "Name too long";
  if (String(d.code).length > 50) return "Code too long";
  if (safeNumber(d.price) < 0) return "Price cannot be negative";
  return null;
}

// =====================================================
// LOGIN (MIGRATED SAFE)
// =====================================================
app.post("/login", async (req, res) => {
  const username = sanitizeText(req.body.username);
  const password = sanitizeText(req.body.password);

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password required"
    });
  }

  try {
    const result = await query(
      "SELECT * FROM users WHERE username=$1 AND password=$2",
      [username, password]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    res.json({
      success: true,
      role: user.role
    });

  } catch (err) {
    return handleDbError(res, err, "Login failed");
  }
});

// =====================================================
// GET PRODUCTS (MIGRATED SAFE)
// =====================================================
app.get("/products", async (req, res) => {
  try {
    const result = await query("SELECT * FROM products ORDER BY category");
    res.json(result.rows || []);
  } catch (err) {
    return handleDbError(res, err, "Failed to fetch products");
  }
});

// =====================================================
// ADD PRODUCT (MIGRATED SAFE)
// =====================================================
app.post("/products", async (req, res) => {
  const d = req.body;

  const name = sanitizeText(d.name);
  const code = sanitizeText(d.code);
  const category = sanitizeText(d.category) || "General";
  const details = sanitizeText(d.details);
  const unit = sanitizeText(d.unit) || "pcs";
  const quantity = safeNumber(d.quantity);
  const price = safeNumber(d.price);

  const error = validateProduct(d);
  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  try {
    const existing = await query(
      "SELECT * FROM products WHERE code=$1",
      [code]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Product code already exists"
      });
    }

    const inserted = await query(
      `INSERT INTO products 
      (code,name,category,details,unit,quantity,price)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id`,
      [code, name, category, details, unit, quantity, price]
    );

    res.json({
      success: true,
      id: inserted.rows[0].id,
      stockStatus: getStockStatus(quantity)
    });

  } catch (err) {
    return handleDbError(res, err, "Failed to add product");
  }
});

// =====================================================
// UPDATE PRODUCT (MIGRATED SAFE)
// =====================================================
app.put("/products/:id", async (req, res) => {
  const d = req.body;

  const name = sanitizeText(d.name);
  const code = sanitizeText(d.code);
  const category = sanitizeText(d.category);
  const details = sanitizeText(d.details);
  const unit = sanitizeText(d.unit);
  const quantity = safeNumber(d.quantity);
  const price = safeNumber(d.price);

  const error = validateProduct(d);
  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  try {
    const existing = await query(
      "SELECT * FROM products WHERE code=$1 AND id!=$2",
      [code, req.params.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Another product already uses this code"
      });
    }

    await query(
      `UPDATE products SET 
      code=$1,name=$2,category=$3,details=$4,unit=$5,quantity=$6,price=$7
      WHERE id=$8`,
      [code, name, category, details, unit, quantity, price, req.params.id]
    );

    res.json({
      success: true,
      message: "updated",
      stockStatus: getStockStatus(quantity)
    });

  } catch (err) {
    return handleDbError(res, err, "Update failed");
  }
});

// =====================================================
// DELETE (MIGRATED SAFE)
// =====================================================
app.delete("/products/:id", async (req, res) => {
  try {
    await query("DELETE FROM products WHERE id=$1", [req.params.id]);

    res.json({
      success: true,
      message: "deleted"
    });
  } catch (err) {
    return handleDbError(res, err, "Delete failed");
  }
});

// =====================================================
// REPORT (PDF - NOT CHANGED)
// =====================================================
app.get("/report", (req, res) => {
  pgPool.query("SELECT * FROM products ORDER BY category")
    .then(result => {
      const rows = result.rows;

      const filePath = path.join(__dirname, "stock-report.pdf");
      const doc = new PDFDocument({ margin: 40 });
      const stream = fs.createWriteStream(filePath);

      doc.pipe(stream);

      doc.font("Helvetica-Bold").fontSize(18).text("STOCK REPORT", { align: "center" });
      doc.font("Helvetica").fontSize(10).text("Generated: " + new Date().toLocaleString(), {
        align: "center"
      });

      doc.moveDown(1);

      const col = {
        code: 50,
        name: 130,
        category: 270,
        unit: 360,
        qty: 420,
        price: 480
      };

      const drawHeader = () => {
        const y = doc.y;

        doc.font("Helvetica-Bold").fontSize(10);
        doc.text("CODE", col.code, y);
        doc.text("NAME", col.name, y);
        doc.text("CATEGORY", col.category, y);
        doc.text("UNIT", col.unit, y);
        doc.text("QTY", col.qty, y);
        doc.text("PRICE", col.price, y);

        doc.moveDown(0.6);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.6);
      };

      drawHeader();

      let currentCategory = "";
      let categoryTotal = 0;
      let grandTotal = 0;

      rows.forEach((p) => {
        const qty = safeNumber(p.quantity);

        if (p.category !== currentCategory) {
          if (currentCategory !== "") {
            doc.moveDown(0.3);
            doc.font("Helvetica-Bold").text(`Category Total (${currentCategory}): ${categoryTotal}`);
          }

          currentCategory = p.category;
          categoryTotal = 0;

          doc.moveDown(0.3);
          doc.font("Helvetica-Bold").fontSize(12).text("Category: " + currentCategory);
          drawHeader();
        }

        const validQty = qty > 0 ? qty : 0;

       categoryTotal += validQty;
grandTotal += validQty;

        const y = doc.y;

        doc.font("Helvetica").fontSize(10);
        doc.text(p.code || "-", col.code, y);
        doc.text(p.name || "-", col.name, y);
        doc.text(p.category || "-", col.category, y);
        doc.text(p.unit || "-", col.unit, y);
        doc.text(String(qty), col.qty, y);
        doc.text(String(p.price || 0), col.price, y);

        doc.moveDown(0.9);
      });

      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(13)
        .text(`GRAND TOTAL QUANTITY: ${grandTotal}`, { align: "right" });

      doc.end();

      stream.on("finish", () => {
        res.download(filePath);
      });
    })
    .catch(err => handleDbError(res, err, "Report generation failed"));
});// ---------------- SERVER ----------------

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});