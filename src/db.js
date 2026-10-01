"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.ZOT_DATA_DIR || path.join(os.homedir(), ".zot");
const DEFAULT_DB = process.env.ZOT_DB || path.join(DATA_DIR, "zot.db");

function version() {
	try {
		return require("../package.json").version || "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function migrate(db) {
	const sql = fs.readFileSync(
		path.join(__dirname, "..", "migrations.sql"),
		"utf8",
	);
	db.exec(sql);
}

function openDb(dbPath = DEFAULT_DB) {
	if (dbPath !== ":memory:") {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	}
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	migrate(db);
	return db;
}

if (require.main === module) {
	const target = process.argv[2] || DEFAULT_DB;
	const db = openDb(target);
	const tables = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
		)
		.all()
		.map((r) => r.name);
	console.log(`migrated ${target}`);
	console.log(tables.join(","));
	db.close();
}

module.exports = { openDb, migrate, DATA_DIR, DEFAULT_DB, version };
