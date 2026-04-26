require("dotenv").config();
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

// ---------------- SQLITE ----------------
const db = new sqlite3.Database("./database.db");

// ---------------- POSTGRES ----------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---------------- HELPERS ----------------
function runQuery(query, values) {
  return pool.query(query, values);
}
// ---------------- CREATE TABLES (ADD THIS) ----------------
async function createTables() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE,
      name TEXT,
      category TEXT,
      details TEXT,
      unit TEXT,
      quantity REAL,
      price REAL
    );
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT
    );
  `);

  console.log("📦 PostgreSQL tables ready");
}
// ---------------- MIGRATE PRODUCTS ----------------
function migrateProducts() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM products", async (err, rows) => {
      if (err) return reject(err);

      console.log(`📦 Found ${rows.length} products in SQLite`);

      let inserted = 0;
      let skipped = 0;

      for (let p of rows) {
        try {
          await runQuery(
            `INSERT INTO products (code, name, category, details, unit, quantity, price)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (code) DO NOTHING`,
            [
              p.code,
              p.name,
              p.category,
              p.details,
              p.unit,
              p.quantity,
              p.price
            ]
          );

          inserted++;
        } catch (e) {
          console.log("❌ Error inserting product:", p.code);
          skipped++;
        }
      }

      console.log(`✅ Products inserted: ${inserted}`);
      console.log(`⚠️ Skipped (duplicates/errors): ${skipped}`);

      resolve();
    });
  });
}

// ---------------- MIGRATE USERS ----------------
function migrateUsers() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM users", async (err, rows) => {
      if (err) return reject(err);

      console.log(`👤 Found ${rows.length} users in SQLite`);

      let inserted = 0;

      for (let u of rows) {
        try {
          await runQuery(
            `INSERT INTO users (username, password, role)
             VALUES ($1,$2,$3)
             ON CONFLICT (username) DO NOTHING`,
            [u.username, u.password, u.role]
          );

          inserted++;
        } catch (e) {
          console.log("❌ Error inserting user:", u.username);
        }
      }

      console.log(`✅ Users inserted: ${inserted}`);
      resolve();
    });
  });
}

// ---------------- VERIFY ----------------
async function verify() {
  const p = await runQuery("SELECT COUNT(*) FROM products");
  const u = await runQuery("SELECT COUNT(*) FROM users");

  console.log("📊 FINAL VERIFICATION:");
  console.log("Products in PostgreSQL:", p.rows[0].count);
  console.log("Users in PostgreSQL:", u.rows[0].count);
}

// ---------------- RUN MIGRATION ----------------
async function run() {
  try {
    console.log("🚀 Starting migration...\n");

    await createTables();   // ✅ ADD THIS LINE FIRST
    await migrateProducts();
    await migrateUsers();
    await verify();

    console.log("\n🎉 MIGRATION COMPLETED SUCCESSFULLY");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}
run();