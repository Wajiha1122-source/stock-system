const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  console.log("\n--- TABLES ---");
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    console.log(tables);

    tables.forEach(t => {
      console.log(`\n--- SCHEMA: ${t.name} ---`);
      db.all(`PRAGMA table_info(${t.name})`, (e, schema) => {
        console.log(schema);
      });

      console.log(`\n--- DATA: ${t.name} ---`);
      db.all(`SELECT * FROM ${t.name}`, (e, rows) => {
        console.log(rows);
      });
    });
  });
});